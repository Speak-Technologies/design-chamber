import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SystemSummary } from '../../src/shared/types.ts';
import {
  SYSTEM_ROW_BADGES_MAX,
  atSystemsCap,
  deleteSentence,
  homeLine,
  loadFailure,
  pinnedLabel,
  sharedRepoNotice,
  sourceLine,
  systemMenu,
  systemRow,
  systemRowBadges,
  systemsListState,
  usedByLine,
} from '../../src/ui/model/systems-model.ts';

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;
const label = (directory: string): string => directory.split(/[\\/]/).filter(Boolean).pop() ?? directory;

const summary = (over: Partial<SystemSummary> = {}): SystemSummary => ({
  id: 'acme',
  name: 'Acme',
  status: 'ready',
  changesToReview: false,
  sources: { code: null, brand: 0, description: false },
  created: '2026-01-01T00:00:00Z',
  swatches: [],
  usedBy: 0,
  isDefault: false,
  pinnedFor: [],
  updated: ago(2 * HOUR),
  revision: 3,
  empty: false,
  unreadable: null,
  home: 'internal',
  building: false,
  sharedRepoWith: null,
  livingPage: null,
  proposalWaiting: false,
  depth: null,
  ...over,
});

const ids = (badges: ReadonlyArray<{ id: string }>): string[] => badges.map((badge) => badge.id);

test('a plain system shows no badge under its home line', () => {
  const { shown, hidden } = systemRowBadges(summary(), label);
  assert.deepEqual(shown, []);
  assert.deepEqual(hidden, []);
});

test('every badge, in the spec priority: Being built, Changes to review, Default, Pinned, living page', () => {
  const everything = summary({ building: true, changesToReview: true, isDefault: true, pinnedFor: ['C:\\work\\shop'], livingPage: 'out-of-date' });
  const { shown, hidden } = systemRowBadges(everything, label);
  assert.deepEqual(ids(shown), ['building', 'changes']);
  assert.deepEqual(ids(hidden), ['default', 'pinned', 'living']);
  assert.equal(SYSTEM_ROW_BADGES_MAX, 2);
});

test('tones: Being built is info, Changes to review is warning, Default and Pinned are neutral, an unsafe living page is an error', () => {
  const all = [
    ...systemRowBadges(summary({ building: true, changesToReview: true }), label).shown,
    ...systemRowBadges(summary({ isDefault: true, pinnedFor: ['C:\\work\\shop'] }), label).shown,
    ...systemRowBadges(summary({ livingPage: 'unsafe' }), label).shown,
  ];
  assert.deepEqual(all.map((badge) => [badge.id, badge.tone]), [
    ['building', 'info'],
    ['changes', 'warning'],
    ['default', 'neutral'],
    ['pinned', 'neutral'],
    ['living', 'error'],
  ]);
});

test('a third badge folds: two shown, the rest hidden for the "+N" and its tooltip', () => {
  const row = systemRow(summary({ changesToReview: true, isDefault: true, pinnedFor: ['C:\\work\\shop'] }), { nowMs: NOW, locale: 'en', label });
  assert.deepEqual(row.badges.map((badge) => badge.label), ['Changes to review', 'Default']);
  assert.deepEqual(row.more, { text: '+1', title: 'Pinned for shop' });
  assert.ok(row.ariaLabel.includes('Pinned for shop'), 'a folded badge is still read out');
});

test('two folded badges say +2 and list both', () => {
  const row = systemRow(summary({ building: true, changesToReview: true, isDefault: true, pinnedFor: ['C:\\work\\shop'] }), { nowMs: NOW, locale: 'en', label });
  assert.deepEqual(row.more, { text: '+2', title: 'Default, Pinned for shop' });
});

test('no fold when there are two badges or fewer', () => {
  const row = systemRow(summary({ changesToReview: true, isDefault: true }), { nowMs: NOW, locale: 'en', label });
  assert.equal(row.more, null);
  assert.deepEqual(row.badges.map((badge) => badge.id), ['changes', 'default']);
});

test('only an out of date, changed or unsafe living page earns a badge', () => {
  const shown = (livingPage: SystemSummary['livingPage']): string[] => ids(systemRowBadges(summary({ livingPage }), label).shown);
  assert.deepEqual(shown('out-of-date'), ['living']);
  assert.deepEqual(shown('changed'), ['living']);
  assert.deepEqual(shown('unsafe'), ['living']);
  for (const quiet of ['fresh', 'missing', 'reformatted', 'unreadable', null] as const) assert.deepEqual(shown(quiet), [], String(quiet));
  assert.equal(systemRowBadges(summary({ livingPage: 'out-of-date' }), label).shown[0]?.label, 'Living page out of date');
  assert.equal(systemRowBadges(summary({ livingPage: 'unsafe' }), label).shown[0]?.label, 'Living page can’t be checked');
});

test('Pinned names the project for one pin and counts several', () => {
  assert.equal(pinnedLabel(['C:\\work\\shop'], label), 'Pinned for shop');
  assert.equal(pinnedLabel(['C:\\work\\shop', '/home/me/app'], label), 'Pinned for 2 projects');
  assert.equal(pinnedLabel(['/a', '/b', '/c'], label), 'Pinned for 3 projects');
});

test('the home line: In Design Chamber, or Repo with the repo name and its full path as the tooltip', () => {
  assert.deepEqual(homeLine(summary()), { label: 'In Design Chamber', title: 'Kept in your Designs folder' });
  assert.deepEqual(homeLine(summary({ home: { repo: 'tidepool-web', directory: 'C:\\work\\tidepool-web' } })), { label: 'Repo · tidepool-web', title: 'C:\\work\\tidepool-web' });
});

test('the shared-repo notice names the other system, and only a repo-backed system has one', () => {
  const repo = { repo: 'tidepool-web', directory: 'C:\\work\\tidepool-web' };
  assert.equal(sharedRepoNotice(summary({ home: repo, sharedRepoWith: 'Tidepool' })), 'tidepool-web already has a repo-backed system (Tidepool).');
  assert.equal(sharedRepoNotice(summary({ home: repo })), null);
  assert.equal(sharedRepoNotice(summary({ sharedRepoWith: 'Tidepool' })), null);
});

test('the source line says where a system came from, in the order code, brand files, description', () => {
  assert.deepEqual(sourceLine({ code: null, brand: 0, description: false }, label), []);
  assert.deepEqual(sourceLine({ code: { directory: 'C:\\work\\shop', lastScan: ago(HOUR), partial: false }, brand: 2, description: true }, label), ['From shop', 'From brand files', 'Described']);
  assert.deepEqual(sourceLine({ code: null, brand: 1, description: false }, label), ['From brand files']);
});

test('used by: none, one and many', () => {
  assert.equal(usedByLine(0), 'Not used yet');
  assert.equal(usedByLine(1), 'Used by 1 design');
  assert.equal(usedByLine(4), 'Used by 4 designs');
});

test('a row: name, Ready, home, badges, meta and an accessible name that says it all', () => {
  const row = systemRow(
    summary({ name: 'Tidepool', changesToReview: true, usedBy: 4, sources: { code: { directory: 'C:\\work\\shop', lastScan: ago(HOUR), partial: false }, brand: 0, description: false } }),
    { nowMs: NOW, locale: 'en', label },
  );
  assert.equal(row.name, 'Tidepool');
  assert.deepEqual(row.status, { label: 'Ready', tone: 'success' });
  assert.equal(row.home.label, 'In Design Chamber');
  assert.deepEqual(row.meta, ['From shop', 'Used by 4 designs', '2 hr. ago']);
  assert.equal(row.ariaLabel, 'Tidepool, Ready, In Design Chamber, Changes to review. From shop, Used by 4 designs, 2 hr. ago.');
});

test('a draft reads Draft in the info tone', () => {
  assert.deepEqual(systemRow(summary({ status: 'draft' }), { nowMs: NOW, locale: 'en', label }).status, { label: 'Draft', tone: 'info' });
});

test('an unreadable system keeps its reason and is announced as one that can’t be read', () => {
  const row = systemRow(summary({ name: 'Broken one', unreadable: 'Design Chamber can’t read this design system. Its system.json isn’t valid JSON.' }), { nowMs: NOW, locale: 'en', label });
  assert.equal(row.unreadable, 'Design Chamber can’t read this design system. Its system.json isn’t valid JSON.');
  assert.equal(row.ariaLabel, 'Broken one, can’t be read');
});

test('the list state: loading until the first answer, the failure when it never came, empty, ready; a failed refresh keeps its rows', () => {
  assert.equal(systemsListState({ status: 'idle', systems: null }), 'loading');
  assert.equal(systemsListState({ status: 'loading', systems: null }), 'loading');
  assert.equal(systemsListState({ status: 'error', systems: null }), 'error');
  assert.equal(systemsListState({ status: 'ready', systems: [] }), 'empty');
  assert.equal(systemsListState({ status: 'ready', systems: [summary()] }), 'ready');
  assert.equal(systemsListState({ status: 'error', systems: [summary()] }), 'ready');
  assert.equal(systemsListState({ status: 'loading', systems: [] }), 'empty');
});

test('a list that didn’t load: the service not answering is its own sentence, any other failure keeps the service’s words', () => {
  const down = loadFailure({ code: 'NO_SERVICE', message: 'The Design Chamber service is not running. Allow the local service in Settings → Extensions, then try again.' });
  assert.equal(down.title, 'Design Chamber isn’t running');
  assert.ok(down.body.includes('Settings → Extensions'));
  assert.equal(loadFailure({ code: 'REQUEST_FAILED', message: 'It did not answer.' }).title, 'Design Chamber isn’t running');
  const other = loadFailure({ code: 'internal', message: 'The design systems folder could not be read.' });
  assert.deepEqual(other, { title: 'Your design systems didn’t load', body: 'The design systems folder could not be read.' });
  assert.equal(loadFailure(null).title, 'Your design systems didn’t load');
});

test('the New button is held back at the cap, with the reason', () => {
  assert.equal(atSystemsCap(49, 50), null);
  assert.equal(atSystemsCap(50, 50), 'You have 50 design systems, the most Design Chamber keeps. Delete one to make room.');
});

test('the delete confirm says it goes to the trash and what the designs using it keep', () => {
  assert.equal(deleteSentence(0), 'It moves to the trash.');
  assert.equal(deleteSentence(1), 'It moves to the trash. The design that uses it keeps its copy.');
  assert.equal(deleteSentence(4), 'It moves to the trash. The 4 designs that use it keep their copy.');
});

test('the row menu: Make default for a ready system, why it is off for a draft, Remove as default for the default, only Reveal and Delete when unreadable', () => {
  const entries = (menu: ReturnType<typeof systemMenu>): string[] => menu.map((entry) => ('separator' in entry ? '-' : entry.id));
  assert.deepEqual(entries(systemMenu({ status: 'ready', isDefault: false, unreadable: null })), ['open', 'make-default', 'reveal', 'rename', '-', 'delete']);
  assert.deepEqual(entries(systemMenu({ status: 'ready', isDefault: true, unreadable: null })), ['open', 'remove-default', 'reveal', 'rename', '-', 'delete']);
  const draft = systemMenu({ status: 'draft', isDefault: false, unreadable: null }).find((entry) => 'id' in entry && entry.id === 'make-default');
  assert.ok(draft && 'id' in draft && draft.disabled === true && draft.reason === 'Mark it ready first.');
  assert.deepEqual(entries(systemMenu({ status: 'draft', isDefault: false, unreadable: 'x' })), ['reveal', '-', 'delete']);
  const destructive = systemMenu({ status: 'ready', isDefault: false, unreadable: null }).find((entry) => 'id' in entry && entry.id === 'delete');
  assert.ok(destructive && 'destructive' in destructive && destructive.destructive === true);
});
