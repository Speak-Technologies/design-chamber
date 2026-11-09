// Pure rules for reading a version index (phase-0 spec, 0a): what counts as damaged, what a
// damaged copy still protects, and what the drawer is told.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  damagedFileName,
  DAMAGED_KEEP_MAX,
  DAMAGED_KEEP_MS,
  hashesMentioned,
  highestVersionNumber,
  historyStateOf,
  INDEX_READ_MAX_BYTES,
  parseDamagedFileName,
  parseIndexText,
  type DamageKind,
} from '../../../src/service/versions-index.ts';

const hex = (char: string): string => char.repeat(64);

const entry = (n: number, fileHash = hex('a')): Record<string, unknown> => ({
  id: `v${n}`,
  n,
  created: '2026-10-26T10:00:00.000Z',
  reason: 'manual',
  sessionId: null,
  treeHash: hex('b'),
  files: { 'index.html': fileHash },
  bytes: 10,
});

const indexText = (versions: unknown[], extra: Record<string, unknown> = {}): string => JSON.stringify({ version: 1, next: 99, versions, ...extra });

describe('parseIndexText', () => {
  test('a valid index parses with nothing dropped', () => {
    const parsed = parseIndexText(indexText([entry(1), entry(2), entry(3)]));
    assert.equal(parsed.kind, 'ok');
    if (parsed.kind !== 'ok') return;
    assert.equal(parsed.dropped, 0);
    assert.deepEqual(parsed.index.versions.map((v) => v.id), ['v1', 'v2', 'v3']);
    assert.equal(parsed.index.next, 99);
  });

  test('one bad entry of three drops that one and keeps the other two', () => {
    const bad = { ...entry(2), treeHash: 'not-a-hash' };
    const parsed = parseIndexText(indexText([entry(1), bad, entry(3)]));
    assert.equal(parsed.kind, 'ok');
    if (parsed.kind !== 'ok') return;
    assert.equal(parsed.dropped, 1);
    assert.deepEqual(parsed.index.versions.map((v) => v.id), ['v1', 'v3']);
  });

  test('an entry with an escaping path or an untracked path is dropped, not trusted', () => {
    const escaping = { ...entry(2), files: { '../x': hex('c') } };
    const untracked = { ...entry(3), files: { '.versions/index.json': hex('c') } };
    const parsed = parseIndexText(indexText([entry(1), escaping, untracked]));
    assert.equal(parsed.kind, 'ok');
    if (parsed.kind !== 'ok') return;
    assert.equal(parsed.dropped, 2);
    assert.equal(parsed.index.versions.length, 1);
  });

  test('garbage, truncated JSON and non-objects are unreadable', () => {
    assert.deepEqual(parseIndexText('not json at all'), { kind: 'unreadable' });
    assert.deepEqual(parseIndexText(indexText([entry(1), entry(2)]).slice(0, 60)), { kind: 'unreadable' });
    assert.deepEqual(parseIndexText('[1,2,3]'), { kind: 'unreadable' });
    assert.deepEqual(parseIndexText('null'), { kind: 'unreadable' });
    assert.deepEqual(parseIndexText(''), { kind: 'unreadable' });
  });

  test('a UTF-8 byte order mark is stripped', () => {
    const parsed = parseIndexText(`﻿${indexText([entry(1)])}`);
    assert.equal(parsed.kind, 'ok');
  });

  test('a newer version is unsupported, even if the rest of its shape is unknown', () => {
    assert.deepEqual(parseIndexText(indexText([entry(1)], { version: 2 })), { kind: 'unsupported', version: 2 });
    assert.deepEqual(parseIndexText('{"version":7,"items":{}}'), { kind: 'unsupported', version: 7 });
  });

  test('version 0, a missing version, or a non-integer version is unreadable', () => {
    assert.deepEqual(parseIndexText(indexText([], { version: 0 })), { kind: 'unreadable' });
    assert.deepEqual(parseIndexText(indexText([], { version: 1.5 })), { kind: 'unreadable' });
    assert.deepEqual(parseIndexText('{"versions":[]}'), { kind: 'unreadable' });
  });

  test('versions that is not an array is unreadable', () => {
    assert.deepEqual(parseIndexText('{"version":1,"next":2,"versions":{}}'), { kind: 'unreadable' });
  });

  test('a bad next is recomputed from the kept entries; a low next is raised above them', () => {
    const recomputed = parseIndexText(indexText([entry(1), entry(4)], { next: 'oops' }));
    assert.equal(recomputed.kind === 'ok' && recomputed.index.next, 5);
    const raised = parseIndexText(indexText([entry(1), entry(4)], { next: 2 }));
    assert.equal(raised.kind === 'ok' && raised.index.next, 5);
    const empty = parseIndexText(indexText([], { next: -3 }));
    assert.equal(empty.kind === 'ok' && empty.index.next, 1);
  });
});

describe('text scans (used only to protect objects and ids, never to read or write)', () => {
  test('hashesMentioned finds every 64-hex run, even in a truncated file', () => {
    const text = `{"version":1,"versions":[{"files":{"a":"${hex('a')}","b":"${hex('c')}"}},{"files":{"x":"${hex('d').slice(0, 30)}`;
    assert.deepEqual([...hashesMentioned(text)].sort(), [hex('a'), hex('c')]);
  });

  test('highestVersionNumber reads ids out of damaged text', () => {
    assert.equal(highestVersionNumber('{"id":"v3"} {"id" : "v12"} {"id":"v7", "n"'), 12);
    assert.equal(highestVersionNumber('no ids here'), 0);
    assert.equal(highestVersionNumber('{"id":"v0"} {"id":"vx"}'), 0);
  });
});

describe('damaged file names', () => {
  test('round trip, safe on Windows, and sorted by time', () => {
    const at = new Date('2026-11-08T09:05:03.000Z');
    const name = damagedFileName(at, 'recovered', 'ab12');
    assert.equal(name, 'index.damaged-20261108T090503Z-ab12-recovered.json');
    assert.ok(!/[:<>"|?*\\/]/.test(name), 'no character that Windows refuses');
    assert.deepEqual(parseDamagedFileName(name), { at: at.getTime(), kind: 'recovered' });
    const later = damagedFileName(new Date('2026-11-09T00:00:00.000Z'), 'entries', '0000');
    assert.ok([later, name].sort()[0] === name, 'lexical order is time order');
  });

  test('every kind round trips and look-alikes are refused', () => {
    for (const kind of ['entries', 'recovered', 'reset'] as DamageKind[]) {
      assert.equal(parseDamagedFileName(damagedFileName(new Date(0), kind, 'ffff'))?.kind, kind);
    }
    assert.equal(parseDamagedFileName('index.json'), null);
    assert.equal(parseDamagedFileName('index.bak.json'), null);
    assert.equal(parseDamagedFileName('index.damaged-20261308T090503Z-ab12-reset.json'), null, 'month 13');
    assert.equal(parseDamagedFileName('index.damaged-20261108T090503Z-ab12-other.json'), null);
    assert.equal(parseDamagedFileName('index.damaged-20261108T090503Z-../x-reset.json'), null);
  });
});

describe('historyStateOf', () => {
  const recent = { at: 2_000, kind: 'entries' as DamageKind };
  const older = { at: 1_000, kind: 'reset' as DamageKind };

  test('a healthy index with no damaged copy has no notice', () => {
    assert.equal(historyStateOf('ok', []), null);
  });

  test('unsupported beats everything', () => {
    assert.equal(historyStateOf('unsupported', [recent]), 'unsupported');
  });

  test('a current repair, recovery or reset beats the damaged copies on disk', () => {
    assert.equal(historyStateOf('repaired', [older]), 'repaired');
    assert.equal(historyStateOf('recovered', [older]), 'recovered');
    assert.equal(historyStateOf('reset', [recent]), 'reset');
  });

  test('otherwise the newest damaged copy decides', () => {
    assert.equal(historyStateOf('ok', [older, recent]), 'repaired');
    assert.equal(historyStateOf('ok', [recent, older]), 'repaired');
    assert.equal(historyStateOf('ok', [{ at: 5, kind: 'recovered' }]), 'recovered');
    assert.equal(historyStateOf('ok', [older]), 'reset');
  });
});

test('limits are the ones the spec names', () => {
  assert.equal(INDEX_READ_MAX_BYTES, 64 * 1024 * 1024);
  assert.equal(DAMAGED_KEEP_MAX, 5);
  assert.equal(DAMAGED_KEEP_MS, 30 * 24 * 60 * 60 * 1000);
});
