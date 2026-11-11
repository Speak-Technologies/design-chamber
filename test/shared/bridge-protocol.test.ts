import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { artboardIdOf, parseFrameMessage, parsePageMessage } from '../../src/shared/bridge-protocol.ts';

const env = { dc: 1, artboardId: 'home@laptop', nonce: 'n1' };

test('valid frame → page messages parse', () => {
  const messages = [
    { ...env, type: 'ready', docWidth: 1280, docHeight: 3000, title: 'Home' },
    { ...env, type: 'size', docWidth: 1280, docHeight: 3100 },
    { ...env, type: 'scroll', x: 0, y: 420 },
    { ...env, type: 'hit', x: 10, y: 20, element: { selector: 'main > h1', text: 'Hi', html: '<h1>', rect: { x: 0, y: 0, w: 10, h: 10 }, tag: 'h1' } },
    { ...env, type: 'hit', x: 10, y: 20, element: null },
    { ...env, type: 'anchors', results: [{ id: 'c_1', found: true, rect: { x: 1, y: 2, w: 3, h: 4 }, exact: false }, { id: 'c_2', found: false, rect: null, exact: false }] },
    { ...env, type: 'navigate', href: 'screens/checkout.html', hash: '' },
    { ...env, type: 'open-external', url: 'https://example.com/a' },
    { ...env, type: 'wheel', deltaX: 0, deltaY: -120, x: 5, y: 5, ctrl: true },
    { ...env, type: 'key', key: 'Escape', ctrl: false, meta: false, shift: false },
  ];
  for (const message of messages) assert.notEqual(parseFrameMessage(message), null, JSON.stringify(message));
});

test('malformed or foreign frame messages are rejected', () => {
  const bad: unknown[] = [
    null,
    'ready',
    { ...env, type: 'ready', docWidth: 1, docHeight: 1, title: 'x', dc: 2 },
    { ...env, type: 'ready', docWidth: Number.NaN, docHeight: 1, title: 'x' },
    { ...env, type: 'size', docWidth: -1, docHeight: 1 },
    { ...env, type: 'teleport' },
    { ...env, type: 'toString' },
    { ...env, type: 'scroll', x: 0, y: 0, artboardId: '' },
    { ...env, type: 'scroll', x: 0, y: 0, nonce: undefined },
    { ...env, type: 'open-external', url: 'javascript:alert(1)' },
    { ...env, type: 'open-external', url: 'file:///C:/Windows' },
    { ...env, type: 'navigate', href: 'a.html', hash: 'no-hash-sign' },
    { ...env, type: 'key', key: 'F5', ctrl: false, meta: false, shift: false },
    { ...env, type: 'anchors', results: 'all' },
    { ...env, type: 'hit', x: 1, y: 1, element: { selector: 's', text: 't', html: '<a>', rect: { x: 0, y: 0, w: 1, h: 1 }, tag: '' } },
    { ...env, type: 'wheel', deltaX: 0, deltaY: 1e9, x: 0, y: 0, ctrl: false },
  ];
  for (const message of bad) assert.equal(parseFrameMessage(message), null, JSON.stringify(message));
});

test('page → frame messages parse, and frame types are not accepted as page types', () => {
  assert.notEqual(parsePageMessage({ ...env, type: 'set-mode', mode: 'play' }), null);
  assert.notEqual(parsePageMessage({ ...env, type: 'highlight', selector: null }), null);
  assert.notEqual(parsePageMessage({ ...env, type: 'resolve-anchors', anchors: [{ id: 'c_1', selector: 'h1', text: 't', html: '<h1>' }] }), null);
  assert.equal(parsePageMessage({ ...env, type: 'set-mode', mode: 'admin' }), null);
  assert.equal(parsePageMessage({ ...env, type: 'ready', docWidth: 1, docHeight: 1, title: '' }), null);
  assert.equal(parseFrameMessage({ ...env, type: 'init-ack' }), null);
});

test('artboard ids combine screen (or page) and viewport', () => {
  assert.equal(artboardIdOf('home', 'laptop'), 'home@laptop');
  assert.equal(artboardIdOf(null, 'phone'), 'page@phone');
});

// ---- Phase 2 messages (§10.4) ----

const probe = {
  tag: 'h1',
  id: null,
  leaf: true,
  text: 'Ship faster',
  truncated: false,
  sameIndex: 0,
  sameCount: 1,
  dir: 'ltr',
  rect: { x: 0, y: 0, w: 100, h: 40 },
};

describe('edit-probe and edit-probe-result', () => {
  test('valid points and probes parse in their own direction only', () => {
    assert.notEqual(parsePageMessage({ ...env, type: 'edit-probe', x: 10, y: 20 }), null);
    assert.notEqual(parseFrameMessage({ ...env, type: 'edit-probe-result', x: 10, y: 20, probe }), null);
    assert.notEqual(parseFrameMessage({ ...env, type: 'edit-probe-result', x: 10, y: 20, probe: null }), null);
    // sameCount 0 means "not counted": sameIndex 0 is fine then.
    assert.notEqual(parseFrameMessage({ ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, sameIndex: 0, sameCount: 0 } }), null);
    assert.equal(parseFrameMessage({ ...env, type: 'edit-probe', x: 1, y: 1 }), null);
    assert.equal(parsePageMessage({ ...env, type: 'edit-probe-result', x: 1, y: 1, probe: null }), null);
  });

  test('malformed points and probes are rejected', () => {
    const bad: unknown[] = [
      { ...env, type: 'edit-probe', x: '10', y: 20 },
      { ...env, type: 'edit-probe', x: Number.NaN, y: 20 },
      { ...env, type: 'edit-probe', x: 1e9, y: 0 },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, tag: '' } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, tag: 'x'.repeat(65) } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, id: '' } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, id: 'x'.repeat(201) } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, leaf: 'yes' } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, text: 'x'.repeat(5002) } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, truncated: 1 } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, sameIndex: 1, sameCount: 1 } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, sameIndex: -1, sameCount: 2 } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, sameIndex: 0.5, sameCount: 2 } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, sameCount: 5001 } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, sameCount: -1 } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, dir: 'auto' } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, rect: { x: 0, y: 0, w: -1, h: 1 } } },
      { ...env, type: 'edit-probe-result', x: 0, y: 0, probe: 'h1' },
    ];
    for (const message of bad) assert.equal(parseFrameMessage(message), null, JSON.stringify(message));
    // The text cap is TEXT_EDIT_MAX + 1: one over is refused, the bound itself parses.
    assert.notEqual(parseFrameMessage({ ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, text: 'x'.repeat(5001), truncated: true } }), null);
    // An id of exactly 200 chars parses; the probe's id may be null.
    assert.notEqual(parseFrameMessage({ ...env, type: 'edit-probe-result', x: 0, y: 0, probe: { ...probe, id: 'x'.repeat(200) } }), null);
  });
});

describe('set-tokens', () => {
  test('valid preview values parse, including an empty list (clear)', () => {
    assert.notEqual(parsePageMessage({ ...env, type: 'set-tokens', vars: [] }), null);
    assert.notEqual(parsePageMessage({ ...env, type: 'set-tokens', vars: [{ name: '--accent-h', value: '210' }] }), null);
    assert.notEqual(parsePageMessage({ ...env, type: 'set-tokens', vars: [{ name: '--radius', value: '8px' }, { name: '--density', value: '1.2' }] }), null);
    // 12 knobs is the cap.
    const twelve = Array.from({ length: 12 }, (_, i) => ({ name: `--v${i}`, value: '1' }));
    assert.notEqual(parsePageMessage({ ...env, type: 'set-tokens', vars: twelve }), null);
  });

  test('malformed names, values and lists are rejected', () => {
    const bad: unknown[] = [
      { ...env, type: 'set-tokens', vars: 'all' },
      { ...env, type: 'set-tokens', vars: Array.from({ length: 13 }, (_, i) => ({ name: `--v${i}`, value: '1' })) },
      { ...env, type: 'set-tokens', vars: [{ name: 'accent-h', value: '1' }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--', value: '1' }] },
      { ...env, type: 'set-tokens', vars: [{ name: `--${'x'.repeat(65)}`, value: '1' }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--accent; color: red', value: '1' }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--accent', value: '1; color: red' }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--accent', value: '{red}' }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--accent', value: '<script>' }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--accent', value: 'x'.repeat(101) }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--accent', value: "it's" }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--accent', value: 'say "hi' }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--accent', value: 210 }] },
      { ...env, type: 'set-tokens', vars: [{ name: '--accent' }] },
    ];
    for (const message of bad) assert.equal(parsePageMessage(message), null, JSON.stringify(message));
    // Balanced quotes are fine; the value pattern allows them. Parentheses are allowed too:
    // the pattern guards against declaration breakout (`; { } < > \ *`), not against formulas.
    assert.notEqual(parsePageMessage({ ...env, type: 'set-tokens', vars: [{ name: '--font', value: '"Georgia", serif' }] }), null);
    assert.notEqual(parsePageMessage({ ...env, type: 'set-tokens', vars: [{ name: '--gap', value: 'calc(1 + 2)' }] }), null);
    assert.equal(parseFrameMessage({ ...env, type: 'set-tokens', vars: [] }), null, 'set-tokens is page → frame only');
  });
});

describe('storage-sync and storage-batch', () => {
  test('valid changes parse in their own direction only', () => {
    const changes = [['checklist:done', '[1,3,4]'], ['theme', 'dark'], ['gone', null]];
    assert.notEqual(parsePageMessage({ ...env, type: 'storage-sync', clear: false, changes }), null);
    assert.notEqual(parseFrameMessage({ ...env, type: 'storage-batch', clear: true, changes: [] }), null);
    assert.notEqual(parseFrameMessage({ ...env, type: 'storage-batch', clear: false, changes }), null);
    assert.equal(parseFrameMessage({ ...env, type: 'storage-sync', clear: false, changes }), null);
    assert.equal(parsePageMessage({ ...env, type: 'storage-batch', clear: false, changes }), null);
  });

  test('malformed shapes are rejected', () => {
    const bad: unknown[] = [
      { ...env, type: 'storage-batch', clear: 'yes', changes: [] },
      { ...env, type: 'storage-batch', clear: false, changes: 'all' },
      { ...env, type: 'storage-batch', clear: false, changes: [['k']] },
      { ...env, type: 'storage-batch', clear: false, changes: [['k', 'v', 'extra']] },
      { ...env, type: 'storage-batch', clear: false, changes: [['k', 42]] },
      { ...env, type: 'storage-batch', clear: false, changes: [[42, 'v']] },
      { ...env, type: 'storage-batch', clear: false, changes: ['k', 'v'] },
      { ...env, type: 'storage-batch', clear: false },
    ];
    for (const message of bad) assert.equal(parseFrameMessage(message), null, JSON.stringify(message));
    for (const message of bad) {
      const rec = message as Record<string, unknown>;
      assert.equal(parsePageMessage({ ...rec, type: 'storage-sync' }), null, JSON.stringify(message));
    }
  });

  test('the entry cap and the character total are enforced (counted while validating)', () => {
    const tooMany = Array.from({ length: 10_001 }, (_, i) => [`k${i}`, 'v']);
    assert.equal(parseFrameMessage({ ...env, type: 'storage-batch', clear: false, changes: tooMany }), null);
    const atCap = Array.from({ length: 10_000 }, (_, i) => [`k${i}`, 'v']);
    assert.notEqual(parseFrameMessage({ ...env, type: 'storage-batch', clear: false, changes: atCap }), null);
    // One value over the whole character cap: refused.
    const huge = [['k', 'x'.repeat(1_048_577)]];
    assert.equal(parseFrameMessage({ ...env, type: 'storage-batch', clear: false, changes: huge }), null);
    assert.equal(parsePageMessage({ ...env, type: 'storage-sync', clear: false, changes: huge }), null);
    // Keys count too, and the sum across entries is what matters.
    assert.equal(parseFrameMessage({ ...env, type: 'storage-batch', clear: false, changes: [['x'.repeat(1_048_577), '']] }), null);
    const split = [['a', 'x'.repeat(1_048_570)], ['b', 'xxxxxxx']];
    assert.equal(parseFrameMessage({ ...env, type: 'storage-batch', clear: false, changes: split }), null);
    // Exactly at the cap parses (keys plus values).
    const exact = [['k', 'x'.repeat(1_048_575)]];
    assert.notEqual(parseFrameMessage({ ...env, type: 'storage-batch', clear: false, changes: exact }), null);
  });
});
