import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SystemDetail, SystemToken } from '../../src/shared/types.ts';
import {
  NOT_COVERED,
  areaGroups,
  boardScheme,
  countText,
  entryLabel,
  entrySelector,
  firstEntryOf,
  homeLine,
  isCovered,
  readyControl,
  readyNotice,
  reviewFoot,
  reviewProgress,
  sectionOfHit,
  sectionRow,
  unreviewedSections,
} from '../../src/ui/model/system-page-model.ts';
import { noteKey, previewVars, saveRequest, staleSentence, tokenKey, typeKey, type PendingMap } from '../../src/ui/model/system-edit-model.ts';

const token = (name: string, section: SystemToken['section'], light: string, dark: string | null = null): SystemToken => ({
  name,
  section,
  group: null,
  light: { text: light, editable: 'ok', problem: null },
  dark: dark === null ? null : { text: dark, editable: 'ok', problem: null },
  note: '',
  breakpoint: false,
  alsoSet: [],
  fromCode: false,
  problem: null,
});

const detail = (patch: Partial<SystemDetail> = {}): SystemDetail =>
  ({
    id: 'tidepool',
    name: 'Tidepool',
    status: 'draft',
    review: {},
    overview: { text: 'Calm and warm.', problem: null },
    notes: [{ id: 'accessibility', title: 'Accessibility', text: 'Keep contrast.', problem: null }],
    tokens: [token('--brand', 'colours', '#2f6f6a', '#6fc2ba'), token('--surface', 'colours', '#fbfaf7'), token('--space-2', 'spacing', '8px')],
    type: [{ id: 'heading', name: 'Heading', family: 'Inter', size: '28px', weight: '650', lineHeight: '1.2', letterSpacing: '0', case: 'none', note: '' }],
    fonts: [],
    logos: [],
    sourceFiles: [],
    components: [{ id: 'button', name: 'Button', purpose: '', note: '', variants: [], states: [], tokens: [], source: null, example: null, undefinedTokens: [] }],
    patterns: [],
    brand: [],
    coverage: ['foundations', 'components'],
    stamps: { tokens: 'tk:1', systemJson: 'sj:1', overview: 'ov:1', notes: {} },
    usedBy: 0,
    ...patch,
  }) as unknown as SystemDetail;

test('the four areas are spelled out and uncovered ones say so', () => {
  const groups = areaGroups(detail());
  assert.deepEqual(
    groups.map((group) => group.label),
    ['Foundations', 'Components', 'Patterns & voice', 'Brand & marketing'],
  );
  assert.equal(groups[0]?.covered, true);
  assert.equal(groups[2]?.covered, false);
  assert.equal(groups[2]?.meta, 'Not covered');
  assert.equal(groups[0]?.rows.length, 8);
});

test('counts read as plain nouns and an empty section says "Nothing yet"', () => {
  const d = detail();
  assert.equal(countText(d, 'colours'), '2 colours');
  assert.equal(countText(d, 'spacing'), '1 value');
  assert.equal(countText(d, 'typography'), '1 style');
  assert.equal(countText(d, 'overview'), '2 notes');
  assert.equal(countText(d, 'layers'), 'Nothing yet');
});

test('a section row names its count and review state for screen readers', () => {
  const d = detail({ review: { colours: { state: 'looks-good', note: null } } as SystemDetail['review'] });
  assert.equal(sectionRow(d, 'colours').ariaLabel, 'Colours, 2 colours, Looks good');
  assert.equal(sectionRow(d, 'patterns').count, 'Not covered');
});

test('review progress counts only covered sections', () => {
  const d = detail({ review: { colours: { state: 'looks-good', note: null }, patterns: { state: 'looks-good', note: null } } as SystemDetail['review'] });
  const progress = reviewProgress(d);
  assert.equal(progress.done, 1);
  assert.equal(progress.total, 9);
  assert.equal(progress.text, '1 of 9 reviewed');
  assert.ok(!unreviewedSections(d).includes('patterns'));
  assert.ok(unreviewedSections(d).includes('typography'));
});

test('review controls show once: ask, state with the other button only, or nothing when uncovered', () => {
  const d = detail({ review: { typography: { state: 'looks-good', note: null }, spacing: { state: 'needs-work', note: 'Too tight' } } as SystemDetail['review'] });
  const ask = reviewFoot(d, 'colours');
  assert.equal(ask.kind, 'ask');
  assert.deepEqual(ask.kind === 'ask' ? ask.actions : [], ['looks-good', 'needs-work']);
  const good = reviewFoot(d, 'typography');
  assert.equal(good.kind, 'state');
  assert.deepEqual(good.kind === 'state' ? good.actions : [], ['needs-work']);
  const work = reviewFoot(d, 'spacing');
  assert.deepEqual(work.kind === 'state' ? work.actions : [], ['looks-good']);
  const none = reviewFoot(d, 'patterns');
  assert.equal(none.kind, 'uncovered');
  assert.equal(none.text, NOT_COVERED);
  assert.equal(isCovered(d, 'patterns'), false);
});

test('Mark ready is the one primary while a Draft; a Ready system has none', () => {
  assert.deepEqual(readyControl({ status: 'draft' }), { label: 'Mark ready', emphasis: 'primary', state: 'draft' });
  assert.equal(readyControl({ status: 'ready' }).emphasis, 'none');
});

test('the ready notice counts what was not reviewed and offers Review the N', () => {
  assert.deepEqual(readyNotice('Acme', 9), { title: 'Acme is ready.', body: '9 sections weren’t reviewed.', action: 'Review the 9' });
  assert.equal(readyNotice('Acme', 1).action, 'Review it');
  assert.equal(readyNotice('Acme', 1).body, '1 section wasn’t reviewed.');
  assert.equal(readyNotice('Acme', 0).action, null);
});

test('a board click is resolved against the detail, so a made-up entry selects nothing', () => {
  const d = detail();
  assert.equal(sectionOfHit(d, 'token:--brand'), 'colours');
  assert.equal(sectionOfHit(d, 'type:heading'), 'typography');
  assert.equal(sectionOfHit(d, 'component:button'), 'components');
  assert.equal(sectionOfHit(d, 'nonsense'), null);
  assert.equal(sectionOfHit(d, undefined), null);
  assert.equal(sectionOfHit(d, '"]<script>'), null);
});

test('the entry a section scrolls the board to', () => {
  const d = detail();
  assert.equal(firstEntryOf(d, 'colours'), 'token:--brand');
  assert.equal(firstEntryOf(d, 'typography'), 'type:heading');
  assert.equal(firstEntryOf(d, 'components'), 'component:button');
  assert.equal(firstEntryOf(d, 'layers'), null);
  assert.equal(entrySelector('token:--brand'), '[data-dc-entry="token:--brand"]');
  assert.equal(entrySelector('a"b'), '[data-dc-entry="a\\"b"]');
});

test('the ask bar chip names the entry', () => {
  const d = detail();
  assert.deepEqual(entryLabel(d, 'token:--brand'), { tag: 'token', text: '--brand' });
  assert.deepEqual(entryLabel(d, 'type:heading'), { tag: 'type', text: 'Heading' });
  assert.deepEqual(entryLabel(d, 'component:button'), { tag: 'component', text: 'Button' });
});

test('the header line says where the system lives and who uses it', () => {
  assert.equal(homeLine({ home: { kind: 'internal' }, sources: { code: null, brand: 0 }, usedBy: 0 } as never, 'From tidepool-web'), 'In Design Chamber · From tidepool-web · Not used yet');
  assert.equal(homeLine({ home: { kind: 'internal' }, sources: { code: null, brand: 0 }, usedBy: 4 } as never, null), 'In Design Chamber · Used by 4 designs');
});

test('the board follows the host colour scheme', () => {
  assert.equal(boardScheme('dark'), 'dark');
  assert.equal(boardScheme('light'), 'light');
  assert.equal(boardScheme(undefined), 'light');
});

test('a save request carries the stamps of only the files it touches', () => {
  const d = detail();
  assert.equal(saveRequest(new Map(), d), null);
  const tokens: PendingMap = new Map([[tokenKey('--brand', 'light'), { kind: 'token', name: '--brand', mode: 'light', value: ' #a0301f ', section: 'colours', existed: true }]]);
  const request = saveRequest(tokens, d);
  assert.deepEqual(request?.tokens, [{ kind: 'set', name: '--brand', mode: 'light', value: '#a0301f' }]);
  assert.equal(request?.stamps.tokens, 'tk:1');
  assert.equal(request?.stamps.systemJson, undefined);

  const mixed: PendingMap = new Map([
    [typeKey('heading', 'size'), { kind: 'type', id: 'heading', field: 'size', value: '30px' }],
    [noteKey('tokens', '--brand'), { kind: 'note', path: 'tokens', id: '--brand', value: 'Main accent.' }],
  ]);
  const second = saveRequest(mixed, d);
  assert.equal(second?.stamps.systemJson, 'sj:1');
  assert.equal(second?.stamps.tokens, undefined);
  assert.deepEqual(second?.meta, [
    { at: ['type', 'heading', 'size'], value: '30px' },
    { at: ['tokens', '--brand', 'note'], value: 'Main accent.' },
  ]);
});

test('the board previews pending values that look like values, dark ones under the dark name', () => {
  const pending: PendingMap = new Map([
    [tokenKey('--brand', 'light'), { kind: 'token', name: '--brand', mode: 'light', value: '#a0301f', section: 'colours', existed: true }],
    [tokenKey('--brand', 'dark'), { kind: 'token', name: '--brand', mode: 'dark', value: '#ff8866', section: 'colours', existed: true }],
    [tokenKey('--surface', 'light'), { kind: 'token', name: '--surface', mode: 'light', value: 'url(javascript:alert(1))', section: 'colours', existed: true }],
  ]);
  const vars = previewVars(pending);
  assert.equal(vars.length, 2);
  assert.equal(vars[0]?.name, '--brand');
  assert.notEqual(vars[1]?.name, '--brand');
  assert.ok(vars.every((entry) => !entry.value.includes('url(')));
});

test('the stale sentence names the system and says nothing was saved', () => {
  assert.equal(staleSentence('Tidepool'), 'Tidepool changed while you were editing. Nothing was saved.');
});
