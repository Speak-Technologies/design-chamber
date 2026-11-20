// Text shaped like a secret (documentation/specs/phase-2-5-technical.md §5.11 rev 3, T14): each shape is
// found wherever an entry's text lands on the living page, and named by that entry; picture and font
// bytes and short look-alikes are never hits.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SECRET_SHAPES_MAX } from '../../../src/shared/limits.ts';
import { findSecretShapes } from '../../../src/shared/secret-shapes.ts';
import type { SecretShapeKind, SystemDetail } from '../../../src/shared/types.ts';
import { buildLivingPage, entryAt } from '../../../src/service/systems/living-html.ts';
import { boardFixture } from './board-fixture.ts';

// Built from parts so no file in the repo holds a whole token shape.
const SAMPLES: readonly { kind: SecretShapeKind; value: string }[] = [
  { kind: 'aws-key', value: `${'AKIA'}${'ABCDEFGH'}${'23456789'}` },
  { kind: 'github-token', value: `${'ghp_'}${'a1B2c3D4e5'.repeat(4)}` },
  { kind: 'github-token', value: `${'github_pat_'}${'11ABCDEFG0'.repeat(3)}` },
  { kind: 'openai-style-key', value: `${'sk-proj-'}${'Ab12Cd34Ef'.repeat(3)}` },
  { kind: 'slack-token', value: `${'xoxb-'}${'1234567890-abcdefghij'}` },
  { kind: 'google-key', value: `${'AIza'}${'Sy0123456789abcdefgh_-ijklmnopqrstu'}` },
  { kind: 'private-key', value: `${'-----BEGIN RSA '}${'PRIVATE KEY-----'}` },
];

const PLACES: readonly { where: string; put: (detail: SystemDetail, value: string) => SystemDetail }[] = [
  { where: 'note:history', put: (d, v) => ({ ...d, notes: d.notes.map((note) => (note.id === 'history' ? { ...note, text: `Rotated on Monday: ${v} is gone.` } : note)) }) },
  { where: 'brand:hero', put: (d, v) => ({ ...d, brand: d.brand.map((entry) => (entry.id === 'hero' ? { ...entry, text: `Shot in daylight. ${v}` } : entry)) }) },
  { where: 'token:--brand', put: (d, v) => ({ ...d, tokens: d.tokens.map((token) => (token.name === '--brand' ? { ...token, note: `Primary actions. ${v}` } : token)) }) },
  { where: 'component:button', put: (d, v) => ({ ...d, components: d.components.map((component) => (component.id === 'button' ? { ...component, name: `Button ${v}` } : component)) }) },
];

const page = (detail: SystemDetail) => buildLivingPage(detail, { revision: 3, generatedAt: '2026-11-19T10:00:00.000Z', coverage: detail.coverage, redact: [] });

test('the plain fixture page has no secret shapes', () => {
  assert.deepEqual(findSecretShapes(page(boardFixture()).html), []);
});

for (const { kind, value } of SAMPLES) {
  for (const { where, put } of PLACES) {
    test(`${kind} (${value.slice(0, 6)}…) in ${where} is found and named by its entry`, () => {
      const doc = page(put(boardFixture(), value));
      const hits = findSecretShapes(doc.html);
      assert.equal(hits.length, 1, JSON.stringify(hits));
      assert.equal(hits[0]?.kind, kind);
      assert.equal(entryAt(doc.ranges, hits[0]?.index ?? -1), where);
    });
  }
}

test('a hit records the kind and position, never the value', () => {
  const [hit] = findSecretShapes(`x ${SAMPLES[0]?.value} y`);
  assert.deepEqual(hit, { kind: 'aws-key', index: 2 });
  assert.deepEqual(Object.keys(hit ?? {}).sort(), ['index', 'kind']);
});

test('nothing is found inside data: URL payloads', () => {
  const payload = SAMPLES.map((sample) => sample.value.replace(/\s/g, '')).join('');
  const html = `<img src="data:image/png;base64,${payload}" alt=""><style>@font-face { src: url("data:font/woff2;base64,${payload}"); }</style>`;
  assert.deepEqual(findSecretShapes(html), []);
  // Real base64 of random-looking bytes.
  const bytes = Buffer.alloc(64 * 1024);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 2654435761) >>> 24;
  assert.deepEqual(findSecretShapes(`<img src="data:image/png;base64,${bytes.toString('base64')}" alt="">`), []);
});

test('the text after a data: URL is still scanned, at its own index', () => {
  const html = `<img src="data:image/png;base64,AAAA" alt="${SAMPLES[0]?.value}">`;
  const hits = findSecretShapes(html);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.index, html.indexOf('AKIA'));
});

test('short or partial look-alikes are not found', () => {
  for (const text of ['sk-short', 'sk-abc', 'AKIA1234', 'ghp_short', 'xoxb-1', 'AIzaShort', 'BEGIN PUBLIC KEY', '-----BEGIN CERTIFICATE-----', 'task-0123456789abcdefghijk']) {
    assert.deepEqual(findSecretShapes(`Note: ${text} here.`), [], text);
  }
});

test('hits are in position order and capped', () => {
  const many = Array.from({ length: SECRET_SHAPES_MAX + 5 }, (_, i) => SAMPLES[i % SAMPLES.length]?.value).join(' and ');
  const hits = findSecretShapes(many);
  assert.equal(hits.length, SECRET_SHAPES_MAX);
  for (let i = 1; i < hits.length; i += 1) assert.ok((hits[i]?.index ?? 0) > (hits[i - 1]?.index ?? 0));
});

test('a match two shapes share is one hit', () => {
  // `github_pat_` only matches its own pattern; an AWS key inside a word is no hit at all.
  assert.equal(findSecretShapes(SAMPLES[2]?.value ?? '').length, 1);
  assert.deepEqual(findSecretShapes(`x${SAMPLES[0]?.value}`), []);
});
