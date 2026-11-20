// The pure rules of a design's copy of its system (documentation/specs/phase-2-5-technical.md §2.6,
// §2.7): COPY.json validation, overrides and own tokens, the preview diffs, drift, and what the
// design and the list show.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  componentDiff,
  copyDrift,
  designSystemStatus,
  designSystemSummary,
  overridesOf,
  ownTokensOf,
  parseCopyRecord,
  parseCopyRecordText,
  tokenDiff,
} from '../../src/shared/system-copy.ts';
import type { CopyRecord } from '../../src/shared/types.ts';

const H = 'a'.repeat(64);
const record = (over: Partial<CopyRecord> = {}): CopyRecord => ({
  v: 1,
  id: 'acme',
  name: 'Acme',
  revision: 3,
  treeHash: H,
  at: '2026-11-20T10:00:00.000Z',
  by: 'user',
  before: 'v4',
  files: { 'tokens.css': H, 'fonts/inter.woff2': 'b'.repeat(64) },
  ...over,
});

test('parseCopyRecord keeps a record Design Chamber writes', () => {
  assert.deepEqual(parseCopyRecord(record()), record());
  assert.deepEqual(parseCopyRecordText(`${JSON.stringify(record({ before: null, by: 'creation' }))}\n`), record({ before: null, by: 'creation' }));
});

test('parseCopyRecord refuses anything an agent could forge into a path or a wrong link', () => {
  const bad: unknown[] = [
    null,
    [],
    { ...record(), v: 2 },
    { ...record(), id: '../acme' },
    { ...record(), id: 'Acme' },
    { ...record(), name: '' },
    { ...record(), name: 'a\nb' },
    { ...record(), revision: -1 },
    { ...record(), revision: 1.5 },
    { ...record(), treeHash: 'nope' },
    { ...record(), at: 'yesterday' },
    { ...record(), by: 'root' },
    { ...record(), before: '../v1' },
    { ...record(), files: { '../../etc/passwd': H } },
    { ...record(), files: { '/abs.css': H } },
    { ...record(), files: { 'fonts\\x.woff2': H } },
    { ...record(), files: { '.hidden': H } },
    { ...record(), files: { 'COPY.json': H } },
    { ...record(), files: { 'tokens.css': 'short' } },
  ];
  for (const value of bad) assert.equal(parseCopyRecord(value), null, JSON.stringify(value));
  assert.equal(parseCopyRecordText('{not json'), null);
});

const COPY = ':root {\n  --brand: #111;\n  --space: 4px;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --brand: #eee;\n  }\n}\n';

test('overridesOf lists the design declarations the copy defines; other contexts are styling, not overrides', () => {
  const design = ':root {\n  --brand: red;\n  --own: 1px;\n}\n.card {\n  --space: 9px;\n}\n';
  assert.deepEqual(overridesOf(COPY, design), [{ name: '--brand', value: 'red', systemValue: '#111' }]);
  assert.deepEqual(ownTokensOf(COPY, design), ['--own']);
  // Only the dark value overridden: the dark system value is what it replaces.
  const dark = '@media (prefers-color-scheme: dark) {\n  :root {\n    --brand: black;\n  }\n}\n';
  assert.deepEqual(overridesOf(COPY, dark), [{ name: '--brand', value: 'black', systemValue: '#eee' }]);
  assert.deepEqual(overridesOf(null, design), []);
  assert.deepEqual(overridesOf(COPY, null), []);
});

test('tokenDiff: changed (either mode), added and removed names', () => {
  const next = ':root {\n  --brand: #111;\n  --new: 2px;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --brand: #fff;\n  }\n}\n';
  assert.deepEqual(tokenDiff(COPY, next), { changed: [{ name: '--brand', from: '#111', to: '#111' }], added: ['--new'], removed: ['--space'] });
  assert.deepEqual(tokenDiff(COPY, null), { changed: [], added: [], removed: ['--brand', '--space'] });
});

test('componentDiff compares components by id', () => {
  const from = JSON.stringify({ components: [{ id: 'button', name: 'Button' }, { id: 'card', name: 'Card' }] });
  const to = JSON.stringify({ components: [{ id: 'button', name: 'Button 2' }, { id: 'tag', name: 'Tag' }] });
  assert.deepEqual(componentDiff(from, to), { changed: ['button'], added: ['tag'], removed: ['card'] });
  assert.deepEqual(componentDiff('{broken', to), { changed: [], added: ['button', 'tag'], removed: [] });
});

test('copyDrift: changed, missing and unlisted files; token names when both texts are known; overrides are not drift', () => {
  const copy = record();
  assert.deepEqual(copyDrift(copy, { 'tokens.css': H, 'fonts/inter.woff2': 'b'.repeat(64), 'COPY.json': 'c'.repeat(64) }), { changed: [], missing: [], extra: [], tokens: [] });
  const drift = copyDrift(copy, { 'tokens.css': 'd'.repeat(64), 'notes/x.md': H }, { original: COPY, current: COPY.replace('#111', '#222') });
  assert.deepEqual(drift, { changed: ['tokens.css'], missing: ['fonts/inter.woff2'], extra: ['notes/x.md'], tokens: ['--brand'] });
});

test('designSystemStatus: the copy names the link; without one the decision answers', () => {
  const systems = [{ id: 'acme', name: 'Acme Co', status: 'ready' as const, revision: 5 }, { id: 'wip', name: 'WIP', status: 'draft' as const, revision: 1 }];
  assert.deepEqual(designSystemStatus({ copy: record(), copyInvalid: false, decision: 'system', systems }), { state: 'linked', id: 'acme', name: 'Acme Co', linkState: 'ok' });
  assert.deepEqual(designSystemStatus({ copy: record({ id: 'wip' }), copyInvalid: false, decision: 'system', systems }), { state: 'linked', id: 'wip', name: 'WIP', linkState: 'draft' });
  assert.deepEqual(designSystemStatus({ copy: record({ id: 'gone', name: 'Gone' }), copyInvalid: false, decision: 'system', systems }), { state: 'linked', id: 'gone', name: 'Gone', linkState: 'deleted' });
  assert.deepEqual(designSystemStatus({ copy: null, copyInvalid: true, decision: 'system', systems }), { state: 'invalid' });
  assert.deepEqual(designSystemStatus({ copy: null, copyInvalid: false, decision: 'ask', systems }), { state: 'ask' });
  assert.deepEqual(designSystemStatus({ copy: null, copyInvalid: false, decision: 'none', systems }), { state: 'none' });
  // A restore went back before the link: no copy, decision system → No design system.
  assert.deepEqual(designSystemStatus({ copy: null, copyInvalid: false, decision: 'system', systems }), { state: 'none' });
  assert.deepEqual(designSystemStatus({ copy: null, copyInvalid: false, decision: undefined, systems }), { state: 'unset' });
});

test('designSystemSummary: an update is available only for a Ready system with a newer revision', () => {
  const systems = [{ id: 'acme', name: 'Acme', status: 'ready' as const, revision: 5 }];
  assert.deepEqual(designSystemSummary(record(), systems), { id: 'acme', name: 'Acme', revision: 3, state: 'ok', updateAvailable: true });
  assert.equal(designSystemSummary(record({ revision: 5 }), systems).updateAvailable, false);
  assert.deepEqual(designSystemSummary(record(), [{ id: 'acme', name: 'Acme', status: 'draft', revision: 5 }]), { id: 'acme', name: 'Acme', revision: 3, state: 'draft', updateAvailable: false });
  assert.deepEqual(designSystemSummary(record(), []), { id: 'acme', name: 'Acme', revision: 3, state: 'deleted', updateAvailable: false });
});
