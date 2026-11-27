import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SystemSummary } from '../../src/shared/types.ts';
import {
  canPreviewLivingPage,
  libraryTileLabel,
  librarySystemMenu,
  plateSwatches,
  showsLivingPageButton,
  sidebarSystems,
  swatchLookup,
  systemRow,
  usedByLinkLabel,
} from '../../src/ui/model/systems-model.ts';

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const HOUR = 3_600_000;
const label = (directory: string): string => directory.split(/[\\/]/).filter(Boolean).pop() ?? directory;

const summary = (over: Partial<SystemSummary> = {}): SystemSummary => ({
  id: 'speak',
  name: 'Speak UI',
  status: 'ready',
  changesToReview: false,
  sources: { code: null, brand: 0, description: false },
  created: '2026-01-01T00:00:00Z',
  swatches: [],
  usedBy: 6,
  isDefault: false,
  pinnedFor: [],
  updated: new Date(NOW - 5 * HOUR).toISOString(),
  revision: 3,
  empty: false,
  unreadable: null,
  home: { repo: 'speakappi', directory: 'C:\\work\\speakappi' },
  building: false,
  sharedRepoWith: null,
  livingPage: 'fresh',
  proposalWaiting: false,
  depth: null,
  ...over,
});

test('plateSwatches keeps only values the editor accepts as a colour, at most six', () => {
  const colours = ['#0f766e', 'rgb(1, 2, 3)', 'not a colour', 'url(https://example.com/x)', '#134e4a', '#f59e0b', '#ccfbf1', '#f0fdfa', '#111111'];
  const kept = plateSwatches({ swatches: colours });
  assert.ok(kept.length <= 6, 'the cap');
  assert.ok(kept.includes('#0f766e') && kept.includes('#134e4a'));
  assert.ok(!kept.includes('not a colour'), 'text is not a swatch');
  assert.ok(!kept.some((value) => value.includes('url(')), 'a url is never painted');
  assert.deepEqual(plateSwatches({ swatches: [] }), [], 'no colours: the plate shows its glyph');
});

test('the Living page button is for a repo system with a page to preview; the menu entry follows the state', () => {
  for (const state of ['fresh', 'out-of-date', 'changed', 'reformatted'] as const) {
    assert.equal(canPreviewLivingPage({ livingPage: state }), true, state);
    assert.equal(showsLivingPageButton(summary({ livingPage: state })), true, `${state} on a repo home`);
  }
  for (const state of ['missing', 'unsafe', 'unreadable', null] as const) assert.equal(canPreviewLivingPage({ livingPage: state }), false, String(state));
  assert.equal(showsLivingPageButton(summary({ home: 'internal', livingPage: 'fresh' })), false, 'an internal system has no button, only the menu entry');
  assert.equal(showsLivingPageButton(summary({ unreadable: 'The folder is gone.' })), false);
});

test('the library menu is Open, Preview living page when there is one, Reveal in folder; an unreadable system only reveals', () => {
  assert.deepEqual(librarySystemMenu(summary()).map((entry) => entry.label), ['Open', 'Preview living page', 'Reveal in folder']);
  assert.deepEqual(librarySystemMenu(summary({ livingPage: null })).map((entry) => entry.label), ['Open', 'Reveal in folder']);
  assert.deepEqual(librarySystemMenu(summary({ unreadable: 'Design Chamber can’t read this system.' })).map((entry) => entry.id), ['reveal']);
});

test('the tile reads out name, kind, state, home, who uses it and when it changed', () => {
  const context = { nowMs: NOW, locale: 'en' };
  assert.equal(libraryTileLabel(summary(), context), 'Speak UI, design system, Ready, Repo · speakappi, used by 6 designs, updated 5 hr. ago');
  assert.equal(libraryTileLabel(summary({ status: 'draft', home: 'internal', usedBy: 0 }), context), 'Speak UI, design system, Draft, In Design Chamber, not used yet, updated 5 hr. ago');
  assert.equal(libraryTileLabel(summary({ unreadable: 'x' }), context), 'Speak UI, design system, can’t be read');
});

test('the used-by link says where it goes, singular and plural', () => {
  assert.equal(usedByLinkLabel(6), 'Used by 6 designs. Show them');
  assert.equal(usedByLinkLabel(1), 'Used by 1 design. Show it');
});

test('a row keeps its facts apart so the used-by part can be a link', () => {
  const row = systemRow(summary({ sources: { code: { directory: 'C:\\work\\speakappi', lastScan: '2026-11-01T00:00:00Z', partial: false }, brand: 1, description: false } }), { nowMs: NOW, locale: 'en', label });
  assert.deepEqual(row.metaParts, { source: ['From speakappi', 'From brand files'], usedBy: { count: 6, text: 'Used by 6 designs' }, updated: '5 hr. ago' });
  assert.deepEqual(row.meta, ['From speakappi', 'From brand files', 'Used by 6 designs', '5 hr. ago'], 'the joined line is unchanged');
  assert.equal(systemRow(summary({ usedBy: 0 }), { nowMs: NOW, locale: 'en', label }).metaParts.usedBy.text, 'Not used yet', 'zero reads Not used yet (no link to nothing)');
});

test('the sidebar rows: by name, with Draft, the used-by count and the first readable colour', () => {
  const rows = sidebarSystems([
    summary({ id: 'tide', name: 'Tidepool', usedBy: 4, swatches: ['#0f766e', '#134e4a'] }),
    summary({ id: 'acme', name: 'acme', status: 'draft', usedBy: 0, swatches: [] }),
    summary({ id: 'bad', name: 'Bad', swatches: ['nope'] }),
  ]);
  assert.deepEqual(rows.map((row) => row.name), ['acme', 'Bad', 'Tidepool'], 'case-insensitive A to Z');
  assert.deepEqual(rows.map((row) => row.draft), [true, false, false]);
  assert.deepEqual(rows.map((row) => row.swatch), [null, null, '#0f766e'], 'no readable colour, no swatch');
  assert.equal(rows[2]?.usedBy, 4);
});

test('swatchLookup finds a system by id and answers null for an unknown one', () => {
  const lookup = swatchLookup([summary({ id: 'tide', swatches: ['#0f766e'] }), summary({ id: 'bare', swatches: [] })]);
  assert.equal(lookup('tide'), '#0f766e');
  assert.equal(lookup('bare'), null);
  assert.equal(lookup('ghost'), null, 'a deleted or unloaded system has no dot colour');
});
