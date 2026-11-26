import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DesignSummary, SystemSummary } from '../../src/shared/types.ts';
import {
  ALL_SCOPE,
  ALL_SYSTEMS,
  DEFAULT_RAIL_VIEW,
  DEFAULT_SORT,
  RAIL_FILTER_DEFAULTS,
  RAIL_VIEWS,
  SHOW_SYSTEM_LABEL,
  UNKNOWN_SYSTEM_LABEL,
  libraryItems,
  railFilterState,
  railSystemStorageKey,
  railViewFromStored,
  railViewStorageKey,
  sortFromStored,
  showSystemOptions,
  sortStorageKey,
  systemFilterLabel,
  systemSelectOptions,
  systemFilterFromId,
  systemFilterToId,
  type SystemFilter,
} from '../../src/ui/model/list-model.ts';

const design = (over: Partial<DesignSummary> & Pick<DesignSummary, 'slug'>): DesignSummary => ({
  kind: 'canvas',
  title: over.slug,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  sessionId: null,
  screenCount: 1,
  openComments: 0,
  pending: false,
  projectDirectory: null,
  ...over,
} as DesignSummary);

const withSystem = (id: string, state: 'ready' | 'deleted' = 'ready'): Pick<DesignSummary, 'system'> =>
  ({ system: { id, name: id, state, updateAvailable: false } }) as unknown as Pick<DesignSummary, 'system'>;

const systems = [{ id: 'tidepool', name: 'Tidepool' }, { id: 'harbor', name: 'Harbor' }];

test('the rail remembers its three choices under their own keys', () => {
  assert.equal(railViewStorageKey, 'rail-view:panel');
  assert.equal(railSystemStorageKey, 'list-system:panel');
  assert.equal(sortStorageKey('panel'), 'list-sort:panel');
  // The page's view key is a different one: the rail's Titles never leaks into the page's Tiles.
  assert.notEqual(railViewStorageKey, 'library-view:page');
});

test('the view reads back as stored; anything else is the list the rail always had', () => {
  assert.equal(railViewFromStored('titles'), 'titles');
  assert.equal(railViewFromStored('list'), 'list');
  for (const junk of [undefined, null, '', 'tiles', 'TITLES', 3, {}, ['titles']]) assert.equal(railViewFromStored(junk), DEFAULT_RAIL_VIEW);
  assert.equal(DEFAULT_RAIL_VIEW, 'list');
  assert.deepEqual(RAIL_VIEWS.map((entry) => entry.id), ['titles', 'list']);
});

test('the system filter survives a round trip through its stored id', () => {
  const cases: SystemFilter[] = [ALL_SYSTEMS, { kind: 'none' }, { kind: 'system', id: 'tidepool' }];
  for (const filter of cases) assert.deepEqual(systemFilterFromId(systemFilterToId(filter)), filter);
  // A stored value nobody can use is All systems, never a crash.
  for (const junk of [undefined, null, 7, 'system:', 'system:Bad Id!', 'harbor', '']) assert.deepEqual(systemFilterFromId(junk), ALL_SYSTEMS);
});

test('the sort reads back as stored, with Updated as the fallback', () => {
  assert.equal(sortFromStored('title'), 'title');
  assert.equal(sortFromStored('created'), 'created');
  assert.equal(sortFromStored('nonsense'), DEFAULT_SORT);
});

test('no dot and a plain name while nothing narrows the list', () => {
  const state = railFilterState({ ...RAIL_FILTER_DEFAULTS, systems });
  assert.equal(state.filtering, false);
  assert.equal(state.changed, 0);
  assert.equal(state.buttonLabel, 'Filters');
  assert.equal(state.summary, '');
});

test('a system filter turns the dot on and the button says what is filtered', () => {
  const named = railFilterState({ ...RAIL_FILTER_DEFAULTS, system: { kind: 'system', id: 'tidepool' }, systems });
  assert.equal(named.filtering, true);
  assert.equal(named.buttonLabel, 'Filters, on. Showing designs that use Tidepool');
  const none = railFilterState({ ...RAIL_FILTER_DEFAULTS, system: { kind: 'none' }, systems });
  assert.equal(none.filtering, true);
  assert.equal(none.summary, 'Showing designs with no system');
  // The systems list has not loaded yet: still filtered, still honest, no name made up.
  const waiting = railFilterState({ ...RAIL_FILTER_DEFAULTS, system: { kind: 'system', id: 'tidepool' }, systems: [] });
  assert.equal(waiting.filtering, true);
  assert.equal(waiting.summary, 'Showing designs that use one system');
});

test('sort and view change the order and the look, so they never switch the dot on', () => {
  const state = railFilterState({ system: ALL_SYSTEMS, sort: 'title', view: 'titles', systems });
  assert.equal(state.filtering, false);
  assert.equal(state.buttonLabel, 'Filters');
  // They do count as changes, so Reset filters is offered.
  assert.equal(state.changed, 2);
  assert.equal(railFilterState({ system: { kind: 'none' }, sort: 'created', view: 'titles', systems }).changed, 3);
});

test('the reset target is the rail as it looked before Filters existed', () => {
  assert.deepEqual(RAIL_FILTER_DEFAULTS, { system: { kind: 'all' }, sort: 'updated', view: 'list' });
});

test('the system filter works on the rail: designs only, no system rows, counts of designs', () => {
  const designs = [
    design({ slug: 'a', ...withSystem('tidepool') }),
    design({ slug: 'b', ...withSystem('harbor') }),
    design({ slug: 'c' }),
    design({ slug: 'd', ...withSystem('tidepool', 'deleted') }),
  ];
  const summaries = [{ id: 'tidepool', name: 'Tidepool', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' }] as unknown as SystemSummary[];
  const run = (system: SystemFilter) =>
    libraryItems({ designs, systems: summaries, scope: ALL_SCOPE, folders: [], designsRoot: '', filters: { query: '', tab: 'all', system }, sort: 'title', surface: 'rail' });
  const slugs = (system: SystemFilter): string[] => run(system).items.flatMap((item) => (item.kind === 'design' ? [item.design.slug] : []));

  assert.deepEqual(slugs(ALL_SYSTEMS), ['a', 'b', 'c', 'd']);
  assert.deepEqual(slugs({ kind: 'system', id: 'tidepool' }), ['a']);
  // A deleted system counts as no system: the design keeps its copy, but the link is gone.
  assert.deepEqual(slugs({ kind: 'none' }), ['c', 'd']);
  assert.deepEqual(slugs({ kind: 'system', id: 'nobody' }), []);
  // The rail never shows a system row, even when the filter names a system, and its counts are designs.
  const filtered = run({ kind: 'system', id: 'tidepool' });
  assert.equal(filtered.items.every((item) => item.kind === 'design'), true);
  assert.equal(filtered.lead, null);
  assert.equal(filtered.counts.all, 1);
});

test('sort orders the filtered rail list', () => {
  const designs = [
    design({ slug: 'old', title: 'Banana', updated: '2026-01-01T00:00:00.000Z', created: '2026-03-01T00:00:00.000Z' }),
    design({ slug: 'new', title: 'cherry', updated: '2026-03-01T00:00:00.000Z', created: '2026-01-01T00:00:00.000Z' }),
    design({ slug: 'mid', title: 'Apple', updated: '2026-02-01T00:00:00.000Z', created: '2026-02-01T00:00:00.000Z' }),
  ];
  const order = (sort: 'updated' | 'created' | 'title'): string[] =>
    libraryItems({ designs, systems: [], scope: ALL_SCOPE, folders: [], designsRoot: '', filters: { query: '', tab: 'all', system: ALL_SYSTEMS }, sort, surface: 'rail' }).items.flatMap((item) => (item.kind === 'design' ? [item.design.slug] : []));
  assert.deepEqual(order('updated'), ['new', 'mid', 'old']);
  assert.deepEqual(order('created'), ['old', 'mid', 'new']);
  assert.deepEqual(order('title'), ['mid', 'old', 'new']);
});

const summary = (id: string, name: string, over: Partial<SystemSummary> = {}): SystemSummary =>
  ({ id, name, status: 'ready', usedBy: 0, created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z', home: 'internal', sources: {}, ...over }) as unknown as SystemSummary;

test('the Show select gets one Design systems entry per system, A to Z, with the same ids as the System filter', () => {
  const list = [summary('tidepool', 'Tidepool', { usedBy: 2 }), summary('acme', 'acme', { status: 'draft' }), summary('harbor', 'Harbor')];
  const entries = showSystemOptions(list);
  assert.deepEqual(entries.map((entry) => entry.label), [`${SHOW_SYSTEM_LABEL}acme`, `${SHOW_SYSTEM_LABEL}Harbor`, `${SHOW_SYSTEM_LABEL}Tidepool`]);
  assert.deepEqual(entries.map((entry) => entry.hint), ['Draft', '0', '2']);
  for (const entry of entries) assert.deepEqual(systemFilterFromId(entry.id), { kind: 'system', id: entry.id.slice('system:'.length) });
});

test('no systems, or none known yet, leaves the group out', () => {
  assert.deepEqual(showSystemOptions([]), []);
});

test('the chip names the system, No system, or "One system" when the list cannot say', () => {
  assert.equal(systemFilterLabel(ALL_SYSTEMS, systems), null);
  assert.equal(systemFilterLabel({ kind: 'none' }, systems), 'No system');
  assert.equal(systemFilterLabel({ kind: 'system', id: 'harbor' }, systems), 'Harbor');
  assert.equal(systemFilterLabel({ kind: 'system', id: 'harbor' }, []), UNKNOWN_SYSTEM_LABEL);
  assert.equal(railFilterState({ ...RAIL_FILTER_DEFAULTS, systems }).chip, null);
  assert.deepEqual(railFilterState({ ...RAIL_FILTER_DEFAULTS, system: { kind: 'system', id: 'tidepool' }, systems }).chip, { label: 'Tidepool', removeLabel: 'Remove the Tidepool system filter' });
  assert.deepEqual(railFilterState({ ...RAIL_FILTER_DEFAULTS, system: { kind: 'none' }, systems }).chip, { label: 'No system', removeLabel: 'Remove the no system filter' });
  assert.deepEqual(railFilterState({ ...RAIL_FILTER_DEFAULTS, system: { kind: 'system', id: 'tidepool' }, systems: [] }).chip, { label: 'One system', removeLabel: 'Remove the system filter' });
  // Sort and view alone never put a chip up.
  assert.equal(railFilterState({ system: ALL_SYSTEMS, sort: 'title', view: 'titles', systems }).chip, null);
});

test('KI-30: a remembered system the list cannot name still gets a select entry, before No system', () => {
  const remembered: SystemFilter = { kind: 'system', id: 'tidepool' };
  const failed = systemSelectOptions([], remembered);
  assert.deepEqual(failed.map((entry) => entry.id), ['all', 'system:tidepool', 'none']);
  assert.equal(failed[1]?.label, UNKNOWN_SYSTEM_LABEL);
  // Named by the list, no extra entry; All systems and No system never add one.
  assert.equal(systemSelectOptions([summary('tidepool', 'Tidepool')], remembered).filter((entry) => entry.id === 'system:tidepool').length, 1);
  assert.deepEqual(systemSelectOptions([], ALL_SYSTEMS).map((entry) => entry.id), ['all', 'none']);
  assert.deepEqual(systemSelectOptions([], { kind: 'none' }).map((entry) => entry.id), ['all', 'none']);
});
