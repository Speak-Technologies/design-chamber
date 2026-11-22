import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { DesignSummary, SystemSummary } from '../../src/shared/types.ts';
import { fileSize, relativeTime, plural, folderName, middlePath, zoomPercent } from '../../src/ui/model/format.ts';
import {
  ALL_SCOPE,
  ALL_SYSTEMS,
  LIST_TABS,
  cardProjectLine,
  emptyStateOf,
  filterDesigns,
  folderEmptyBody,
  folderNameProblem,
  foldersOfDesign,
  kindLabel,
  kindSummary,
  libraryDesigns,
  matchesSystem,
  noMatchesSentenceFor,
  projectGroups,
  projectOf,
  resolveScope,
  resolveSystemFilter,
  rowAriaLabel,
  sameScope,
  scopeCounts,
  scopeDesigns,
  scopeFromId,
  scopeLabel,
  scopeOptions,
  scopeStorageKey,
  scopeSystems,
  scopeToId,
  sortDesigns,
  sortFromStored,
  sortStorageKey,
  systemFilterFromId,
  systemFilterToId,
  systemOptions,
  systemProjectOf,
  tabCounts,
  viewFromStored,
  viewStorageKey,
  type FolderLite,
  type ListScope,
  type SystemFilter,
} from '../../src/ui/model/list-model.ts';
import { kindHint, startLabel } from '../../src/ui/model/new-model.ts';

const design = (over: Partial<DesignSummary> & Pick<DesignSummary, 'slug'>): DesignSummary => ({
  kind: 'canvas',
  title: over.slug,
  created: '2026-10-01T10:00:00.000Z',
  updated: '2026-10-01T10:00:00.000Z',
  pending: false,
  screenCount: 3,
  viewports: [],
  sessionId: null,
  projectDirectory: null,
  openComments: 0,
  thumb: { state: 'ready', key: null },
  warnings: [],
  ...over,
});

const set = [
  design({ slug: 'coffee', title: 'Coffee subscription', updated: '2026-10-26T10:00:00.000Z', created: '2026-10-20T10:00:00.000Z' }),
  design({ slug: 'invoice', title: 'Invoice template', kind: 'page', screenCount: 0, updated: '2026-10-25T10:00:00.000Z', created: '2026-10-25T09:00:00.000Z' }),
  design({ slug: 'onboarding', title: 'Onboarding', pending: true, updated: '2026-10-27T10:00:00.000Z', created: '2026-10-10T10:00:00.000Z' }),
];

test('filterDesigns narrows by tab and by a case-insensitive title or slug match', () => {
  assert.deepEqual(filterDesigns(set, '', 'page').map((d) => d.slug), ['invoice']);
  assert.deepEqual(filterDesigns(set, 'COFFEE', 'all').map((d) => d.slug), ['coffee']);
  assert.deepEqual(filterDesigns(set, 'on', 'canvas').map((d) => d.slug), ['coffee', 'onboarding']);
  assert.deepEqual(filterDesigns(set, '  ', 'all'), set);
});

test('tabCounts follow the search so a tab never counts rows the search hides', () => {
  assert.deepEqual(tabCounts(set, ''), { all: 3, canvas: 2, page: 1 });
  assert.deepEqual(tabCounts(set, 'invoice'), { all: 1, canvas: 0, page: 1 });
});

test('sortDesigns orders by updated/created newest first and by title A–Z, without mutating the input', () => {
  const before = set.map((d) => d.slug);
  assert.deepEqual(sortDesigns(set, 'updated').map((d) => d.slug), ['onboarding', 'coffee', 'invoice']);
  assert.deepEqual(sortDesigns(set, 'created').map((d) => d.slug), ['invoice', 'coffee', 'onboarding']);
  assert.deepEqual(sortDesigns(set, 'title').map((d) => d.slug), ['coffee', 'invoice', 'onboarding']);
  assert.deepEqual(set.map((d) => d.slug), before);
});

test('kindSummary and rowAriaLabel use the glossary words and singular/plural correctly', () => {
  assert.equal(kindSummary(design({ slug: 'a', screenCount: 1 })), 'Canvas · 1 screen');
  assert.equal(kindSummary(design({ slug: 'a', screenCount: 3 })), 'Canvas · 3 screens');
  assert.equal(kindSummary(design({ slug: 'a', kind: 'page' })), 'Page');
  assert.equal(rowAriaLabel(design({ slug: 'a', title: 'A', pending: true, openComments: 2 })), 'A, Canvas · 3 screens, waiting for the agent, 2 open comments');
});

test('the user sees "Page", never "artifact", in tabs, labels and the New dialog', () => {
  assert.deepEqual(LIST_TABS.map((t) => t.label), ['All', 'Canvases', 'Pages']);
  assert.equal(kindLabel('page'), 'Page');
  assert.equal(kindLabel('canvas'), 'Canvas');
  assert.equal(startLabel('page'), 'Start page');
  assert.equal(startLabel('canvas'), 'Start canvas');
  for (const text of [...LIST_TABS.map((t) => t.label), kindLabel('page'), startLabel('page'), kindHint('page'), kindHint('canvas')]) {
    assert.doesNotMatch(text, /artifact/i, text);
    assert.doesNotMatch(text, /\u2014/, text);
  }
});

test('relativeTime is plain, locale-aware and tolerant of bad input', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z');
  assert.equal(relativeTime('2026-10-26T11:59:40.000Z', now, 'en'), 'just now');
  assert.match(relativeTime('2026-10-26T11:56:00.000Z', now, 'en'), /4 min/);
  assert.match(relativeTime('2026-10-26T09:00:00.000Z', now, 'en'), /3 hr/);
  assert.equal(relativeTime('2026-10-25T12:00:00.000Z', now, 'en'), 'yesterday');
  assert.equal(relativeTime('not a date', now, 'en'), '');
});

test('small format helpers', () => {
  assert.equal(plural(1, 'comment'), '1 comment');
  assert.equal(plural(0, 'comment'), '0 comments');
  assert.equal(folderName('C:\\Users\\you\\Documents\\Designs\\'), 'Designs');
  assert.equal(zoomPercent(0.254), '25%');
  assert.equal(fileSize(820, 'en'), '820 bytes');
  assert.equal(fileSize(14_200, 'en'), '14 kB');
  assert.equal(fileSize(1_420_000, 'en'), '1.4 MB');
  assert.equal(fileSize(Number.NaN, 'en'), '0 bytes');
});

test('middlePath shortens a long folder path in the middle and keeps the last folder whole', () => {
  const long = 'C:\\Users\\you\\AppData\\Local\\Temp\\dc-smoke-designs';
  assert.equal(middlePath('C:\\Users\\you\\Documents\\Designs'), 'C:\\Users\\you\\Documents\\Designs', 'short paths stay');
  assert.equal(middlePath(long, 30), 'C:\\…\\Temp\\dc-smoke-designs');
  assert.equal(middlePath('/home/someone/projects/client-work/designs/archive', 26), '/…/designs/archive');
  assert.equal(middlePath('C:\\Users\\you\\Documents\\Designs\\', 20), 'C:\\…\\Designs');
  // The last folder alone is longer than the budget: only then is it cut, at its end.
  const short = middlePath(`C:\\Users\\you\\${'a-very-long-folder-name-'.repeat(3)}end`, 24);
  assert.ok(short.length <= 24, short);
  assert.ok(short.endsWith('…'), short);
});

// ---- Projects and folders (G1) ----

const ROOT = 'C:\\Users\\you\\Documents\\Designs';
const SHOP = 'C:\\Users\\you\\work\\shop';
const grouped = [
  design({ slug: 'cart', title: 'Cart', projectDirectory: SHOP, updated: '2026-10-27T10:00:00.000Z' }),
  design({ slug: 'hero', title: 'Hero', kind: 'page', projectDirectory: 'c:/users/you/work/shop/', updated: '2026-10-26T10:00:00.000Z' }),
  design({ slug: 'docs', title: 'Docs site', projectDirectory: 'C:\\Users\\you\\personal\\docs', updated: '2026-10-25T10:00:00.000Z' }),
  design({ slug: 'loose-idea', title: 'Loose idea', projectDirectory: null }),
  design({ slug: 'from-designs-chat', title: 'From a chat in Designs', projectDirectory: `${ROOT}\\scratch` }),
];
const folders: FolderLite[] = [
  { id: 'f_aaaaaaaaaa', name: 'Q4 launch', slugs: ['cart', 'docs', 'gone-slug'] },
  { id: 'f_bbbbbbbbbb', name: 'Explorations', slugs: ['cart'] },
  { id: 'f_cccccccccc', name: 'Empty one', slugs: [] },
];

test('projectOf: no project, the designs folder itself and anything inside it all read as No project', () => {
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: null }), ROOT), null);
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: ROOT }), ROOT), null);
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: ROOT.toLowerCase().replace(/\\/g, '/') + '/' }), ROOT), null, 'case, slash and trailing slash');
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: `${ROOT}\\sub\\deeper` }), ROOT), null);
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: `${ROOT}-old` }), ROOT), `${ROOT}-old`, 'a sibling that only shares the prefix is a project');
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: SHOP }), ROOT), SHOP);
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: '/home/me/app' }), '/home/me/Designs'), '/home/me/app');
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: '/home/me/Designs/x' }), '/home/me/Designs'), null);
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: '/home/me/designs/x' }), '/home/me/Designs'), '/home/me/designs/x', 'POSIX paths are case-sensitive');
  assert.equal(projectOf(design({ slug: 'a', projectDirectory: SHOP }), ''), SHOP, 'an unknown designs folder hides nothing');
});

test('projectGroups groups by sameDirectory, names them from the host list, and counts', () => {
  const groups = projectGroups(grouped, [{ directory: SHOP, name: 'Shop app' }], ROOT, undefined);
  assert.deepEqual(groups.map((g) => [g.label, g.count]), [['docs', 1], ['Shop app', 2]]);
  assert.equal(groups.find((g) => g.label === 'Shop app')?.title, SHOP, 'the full path is the tooltip');
  assert.equal(groups.every((g) => !g.missing), true);
});

test('two projects with the same name show their parent folder too', () => {
  const two = [
    design({ slug: 'a', projectDirectory: 'C:\\work\\app' }),
    design({ slug: 'b', projectDirectory: 'C:\\personal\\app' }),
    design({ slug: 'c', projectDirectory: 'C:\\personal\\other' }),
  ];
  assert.deepEqual(projectGroups(two, [], ROOT, undefined).map((g) => g.label), ['app · personal', 'app · work', 'other']);
});

test('a project folder that no longer exists still groups its designs and says so in the tooltip', () => {
  const groups = projectGroups(grouped, [], ROOT, [{ directory: SHOP, exists: false }, { directory: 'C:\\Users\\you\\personal\\docs', exists: true }]);
  const shop = groups.find((g) => g.count === 2);
  assert.equal(shop?.missing, true);
  assert.equal(groups.find((g) => g.count === 1)?.missing, false);
  assert.match(cardProjectLine(grouped[0] as DesignSummary, ALL_SCOPE, groups, ROOT)?.title ?? '', /Folder not found/);
});

test('scopeDesigns: all, one project, No project, and a folder (multi-membership)', () => {
  const slugs = (scope: ListScope): string[] => scopeDesigns(grouped, scope, folders, ROOT).map((d) => d.slug);
  assert.deepEqual(slugs(ALL_SCOPE), ['cart', 'hero', 'docs', 'loose-idea', 'from-designs-chat']);
  assert.deepEqual(slugs({ kind: 'project', directory: 'C:/Users/you/work/shop' }), ['cart', 'hero'], 'matched by sameDirectory, not by spelling');
  assert.deepEqual(slugs({ kind: 'no-project' }), ['loose-idea', 'from-designs-chat']);
  assert.deepEqual(slugs({ kind: 'folder', id: 'f_aaaaaaaaaa' }), ['cart', 'docs'], 'a name the list does not have never shows');
  assert.deepEqual(slugs({ kind: 'folder', id: 'f_bbbbbbbbbb' }), ['cart'], 'cart sits in two folders');
  assert.deepEqual(slugs({ kind: 'folder', id: 'f_cccccccccc' }), []);
  assert.deepEqual(slugs({ kind: 'folder', id: 'f_zzzzzzzzzz' }), [], 'an unknown folder is empty, not everything');
});

test('search, tab and sort work inside a scope, and tab counts follow it', () => {
  const inShop = scopeDesigns(grouped, { kind: 'project', directory: SHOP }, folders, ROOT);
  assert.deepEqual(tabCounts(inShop, ''), { all: 2, canvas: 1, page: 1 });
  assert.deepEqual(tabCounts(inShop, 'hero'), { all: 1, canvas: 0, page: 1 });
  assert.deepEqual(sortDesigns(filterDesigns(inShop, '', 'all'), 'title').map((d) => d.slug), ['cart', 'hero']);
  assert.deepEqual(sortDesigns(filterDesigns(inShop, '', 'page'), 'updated').map((d) => d.slug), ['hero']);
  const hidden = emptyStateOf({ all: grouped, scoped: inShop, shown: filterDesigns(inShop, 'zzz', 'all'), scope: { kind: 'project', directory: SHOP }, scopeLabel: 'shop', folderName: null, filters: { query: 'zzz', tab: 'all', system: ALL_SYSTEMS }, systems: [], draggable: false });
  assert.equal(hidden?.kind, 'no-matches');
});

test('scopeCounts counts only designs that are in the list, per folder, and No project', () => {
  assert.deepEqual(scopeCounts(grouped, folders, ROOT), { all: 5, noProject: 2, folders: { f_aaaaaaaaaa: 2, f_bbbbbbbbbb: 1, f_cccccccccc: 0 } });
  assert.deepEqual(scopeCounts([], [], ROOT), { all: 0, noProject: 0, folders: {} });
});

test('a design in several folders is found by each, and foldersOfDesign lists them', () => {
  assert.deepEqual(foldersOfDesign('cart', folders).map((f) => f.name), ['Q4 launch', 'Explorations']);
  assert.deepEqual(foldersOfDesign('hero', folders), []);
});

test('noMatchesSentenceFor names the scope, the search and the system (the approved canvas sentence)', () => {
  const systems = [{ id: 'speak', name: 'Speak UI' }];
  assert.equal(noMatchesSentenceFor({ scopeLabel: 'Q4 launch', query: 'hero', system: { kind: 'system', id: 'speak' }, systems }), 'No designs in Q4 launch match “hero” with the Speak UI system.');
  assert.equal(noMatchesSentenceFor({ scopeLabel: 'shop', query: '  hero ', system: ALL_SYSTEMS, systems }), 'No designs in shop match “hero”.');
  assert.equal(noMatchesSentenceFor({ scopeLabel: null, query: 'hero', system: ALL_SYSTEMS, systems }), 'No designs match “hero”.');
  assert.equal(noMatchesSentenceFor({ scopeLabel: 'shop', query: '', system: { kind: 'none' }, systems }), 'No designs in shop with no system.');
  assert.equal(noMatchesSentenceFor({ scopeLabel: null, query: '', system: { kind: 'system', id: 'gone' }, systems }), 'Nothing in this tab yet', 'a gone system drops its clause; the tab-only fallback reads');
  assert.equal(noMatchesSentenceFor({ scopeLabel: 'shop', query: '', system: ALL_SYSTEMS, systems }), 'Nothing in shop for this tab yet');
});

test('the empty folder says what to do, with or without drag', () => {
  assert.match(folderEmptyBody(true), /Drag designs here/);
  assert.doesNotMatch(folderEmptyBody(false), /Drag/);
  for (const text of [folderEmptyBody(true), folderEmptyBody(false)]) assert.doesNotMatch(text, /\u2014/);
});

test('cardProjectLine shows the project under the title unless the list is that project', () => {
  const groups = projectGroups(grouped, [], ROOT, undefined);
  const cart = grouped[0] as DesignSummary;
  assert.equal(cardProjectLine(cart, ALL_SCOPE, groups, ROOT)?.label, 'shop');
  assert.equal(cardProjectLine(cart, { kind: 'folder', id: 'f_aaaaaaaaaa' }, groups, ROOT)?.label, 'shop');
  assert.equal(cardProjectLine(cart, { kind: 'project', directory: 'c:/users/you/work/shop' }, groups, ROOT), null);
  assert.equal(cardProjectLine(grouped[3] as DesignSummary, ALL_SCOPE, groups, ROOT), null, 'no project, no line');
});

test('resolveScope falls back to All designs when the project or folder is gone', () => {
  const groups = projectGroups(grouped, [], ROOT, undefined);
  assert.deepEqual(resolveScope({ kind: 'project', directory: SHOP }, groups, folders), { kind: 'project', directory: SHOP });
  assert.deepEqual(resolveScope({ kind: 'project', directory: 'C:\\gone' }, groups, folders), ALL_SCOPE);
  assert.deepEqual(resolveScope({ kind: 'folder', id: 'f_zzzzzzzzzz' }, groups, folders), ALL_SCOPE);
  assert.deepEqual(resolveScope({ kind: 'folder', id: 'f_aaaaaaaaaa' }, groups, []), ALL_SCOPE, 'folders that did not load never keep a folder view');
  assert.deepEqual(resolveScope({ kind: 'no-project' }, groups, folders), { kind: 'no-project' });
});

test('the remembered scope round-trips and unknown or hostile values read as All designs', () => {
  const samples: ListScope[] = [ALL_SCOPE, { kind: 'no-project' }, { kind: 'project', directory: SHOP }, { kind: 'folder', id: 'f_aaaaaaaaaa' }];
  for (const scope of samples) assert.ok(sameScope(scopeFromId(scopeToId(scope)), scope), scopeToId(scope));
  for (const bad of [undefined, null, 5, {}, '', 'folder:', 'folder:nope', 'folder:f_AAAAAAAAAA', 'project:', 'something', 'x'.repeat(2000)]) {
    assert.deepEqual(scopeFromId(bad), ALL_SCOPE, String(bad).slice(0, 20));
  }
  assert.equal(scopeStorageKey('panel'), 'list-scope:panel');
  assert.equal(scopeStorageKey('page'), 'list-scope:page');
});

test('scopeOptions lists All designs, projects, No project (only when there are some) and folders, with counts', () => {
  const groups = projectGroups(grouped, [], ROOT, undefined);
  const options = scopeOptions(groups, scopeCounts(grouped, folders, ROOT), folders);
  assert.deepEqual(options.map((o) => [o.label, o.hint]), [['All designs', '5'], ['docs', '1'], ['shop', '2'], ['No project', '2'], ['Folder · Q4 launch', '2'], ['Folder · Explorations', '1'], ['Folder · Empty one', '0']]);
  const none = scopeOptions([], scopeCounts([design({ slug: 'x', projectDirectory: SHOP })], [], ROOT), []);
  assert.deepEqual(none.map((o) => o.id), ['all'], 'no groups passed, no rows, and No project is hidden when there are none');
  for (const option of options) assert.deepEqual(scopeToId(scopeFromId(option.id)), option.id);
});

test('scopeLabel names the scope for a sentence', () => {
  const groups = projectGroups(grouped, [], ROOT, undefined);
  assert.equal(scopeLabel(ALL_SCOPE, groups, folders), null);
  assert.equal(scopeLabel({ kind: 'no-project' }, groups, folders), 'No project');
  assert.equal(scopeLabel({ kind: 'project', directory: SHOP }, groups, folders), 'shop');
  assert.equal(scopeLabel({ kind: 'folder', id: 'f_aaaaaaaaaa' }, groups, folders), 'Q4 launch');
  assert.equal(scopeLabel({ kind: 'folder', id: 'f_zzzzzzzzzz' }, groups, folders), null);
});

test('folderNameProblem: the same rules and sentences as the service, before the request', () => {
  assert.equal(folderNameProblem('Launch', folders), null);
  assert.equal(folderNameProblem('   ', folders), 'Give the folder a name.');
  assert.equal(folderNameProblem('a\tb', folders), "A folder name can't contain line breaks or tabs.");
  assert.equal(folderNameProblem('a\nb', folders), "A folder name can't contain line breaks or tabs.");
  assert.equal(folderNameProblem('x'.repeat(40), folders), null);
  assert.equal(folderNameProblem('x'.repeat(41), folders), 'Keep the folder name to 40 characters or fewer.');
  assert.equal(folderNameProblem('q4 LAUNCH', folders), 'You already have a folder called Q4 launch.');
  assert.equal(folderNameProblem('q4 LAUNCH', folders, 'f_aaaaaaaaaa'), null, 'renaming a folder to its own name in another case is fine');
  assert.equal(folderNameProblem('Explorations', folders, 'f_aaaaaaaaaa'), 'You already have a folder called Explorations.');
  const full = Array.from({ length: 50 }, (_, n) => ({ id: `f_${String(n).padStart(10, '0')}`, name: `F${n}` }));
  assert.equal(folderNameProblem('One more', full), 'You can have up to 50 folders.');
  assert.equal(folderNameProblem('F3 renamed', full, 'f_0000000003'), null, 'a rename is not a new folder');
});

// ---- Library views, sort and the System filter (Phase 2.6 L1a) ----

const TIDEPOOL = 'C:\\Users\\you\\work\\tidepool-web';
const system = (over: Partial<SystemSummary> & Pick<SystemSummary, 'id' | 'name'>): SystemSummary => ({
  status: 'ready',
  changesToReview: false,
  sources: { code: null, brand: 0, description: false },
  created: '2026-01-01T00:00:00Z',
  swatches: [],
  usedBy: 0,
  isDefault: false,
  pinnedFor: [],
  updated: '2026-10-01T10:00:00.000Z',
  revision: 1,
  empty: false,
  unreadable: null,
  home: 'internal',
  building: false,
  sharedRepoWith: null,
  livingPage: null,
  proposalWaiting: false,
  ...over,
});
const link = (id: string, state: 'ok' | 'draft' | 'deleted' = 'ok'): NonNullable<DesignSummary['system']> => ({ id, name: id, revision: 1, state, updateAvailable: false });

test('the remembered view and sort fall back to Tiles and Updated on anything unknown', () => {
  assert.equal(viewStorageKey, 'library-view:page');
  assert.equal(sortStorageKey('panel'), 'list-sort:panel');
  assert.equal(sortStorageKey('page'), 'list-sort:page');
  assert.equal(viewFromStored('list'), 'list');
  assert.equal(viewFromStored('tiles'), 'tiles');
  for (const bad of [undefined, null, 5, {}, '', 'grid', 'LIST', 'list ']) assert.equal(viewFromStored(bad), 'tiles', String(bad));
  assert.equal(sortFromStored('updated'), 'updated');
  assert.equal(sortFromStored('created'), 'created');
  assert.equal(sortFromStored('title'), 'title');
  for (const bad of [undefined, null, 5, {}, '', 'name', 'TITLE', 'updated ']) assert.equal(sortFromStored(bad), 'updated', String(bad));
});

test('the System filter round-trips through its select id; unknown or hostile ids read as All systems', () => {
  const samples: SystemFilter[] = [ALL_SYSTEMS, { kind: 'none' }, { kind: 'system', id: 'tidepool' }];
  for (const filter of samples) assert.deepEqual(systemFilterFromId(systemFilterToId(filter)), filter);
  for (const bad of [undefined, null, 5, {}, '', 'system:', 'system:UPPER', 'system:bad id', 'system:' + 'x'.repeat(64), 'all ', 'nope']) {
    assert.deepEqual(systemFilterFromId(bad), ALL_SYSTEMS, String(bad).slice(0, 20));
  }
});

test('a System filter naming a gone system resolves to All systems; none and all stay', () => {
  const systems = [system({ id: 'tidepool', name: 'Tidepool' })];
  assert.deepEqual(resolveSystemFilter({ kind: 'system', id: 'tidepool' }, systems), { kind: 'system', id: 'tidepool' });
  assert.deepEqual(resolveSystemFilter({ kind: 'system', id: 'gone' }, systems), ALL_SYSTEMS);
  assert.deepEqual(resolveSystemFilter({ kind: 'system', id: 'tidepool' }, []), ALL_SYSTEMS);
  assert.deepEqual(resolveSystemFilter({ kind: 'none' }, systems), { kind: 'none' });
  assert.deepEqual(resolveSystemFilter(ALL_SYSTEMS, systems), ALL_SYSTEMS);
});

test('matchesSystem: a deleted system counts as no system, never as itself', () => {
  const ok = design({ slug: 'a', system: link('tidepool', 'ok') });
  const draft = design({ slug: 'b', system: link('acme', 'draft') });
  const deleted = design({ slug: 'c', system: link('tidepool', 'deleted') });
  const none = design({ slug: 'd', system: null });
  const absent = design({ slug: 'e' });
  assert.equal(matchesSystem(ok, { kind: 'system', id: 'tidepool' }), true);
  assert.equal(matchesSystem(draft, { kind: 'system', id: 'acme' }), true, 'a Draft system still matches its own designs');
  assert.equal(matchesSystem(deleted, { kind: 'system', id: 'tidepool' }), false, 'deleted never matches its own id');
  assert.equal(matchesSystem(deleted, { kind: 'none' }), true);
  assert.equal(matchesSystem(none, { kind: 'none' }), true);
  assert.equal(matchesSystem(absent, { kind: 'none' }), true, 'an absent link reads as none');
  assert.equal(matchesSystem(ok, { kind: 'none' }), false);
  assert.equal(matchesSystem(ok, { kind: 'system', id: 'acme' }), false);
  for (const d of [ok, draft, deleted, none, absent]) assert.equal(matchesSystem(d, ALL_SYSTEMS), true);
});

test('systemOptions lists All systems, each system by name with Draft or its count, then No system', () => {
  const systems = [
    system({ id: 'tidepool', name: 'Tidepool', usedBy: 4 }),
    system({ id: 'acme', name: 'Acme', status: 'draft', usedBy: 0 }),
    system({ id: 'harbor', name: 'Harbor', usedBy: 2 }),
  ];
  assert.deepEqual(systemOptions(systems).map((o) => [o.id, o.label, o.hint]), [
    ['all', 'All systems', undefined],
    ['system:acme', 'Acme', 'Draft'],
    ['system:harbor', 'Harbor', '2'],
    ['system:tidepool', 'Tidepool', '4'],
    ['none', 'No system', undefined],
  ]);
  assert.deepEqual(systemOptions([]).map((o) => o.id), ['all', 'none'], 'no systems: All systems and No system only');
});

test('systemProjectOf reads the repo home, else the code source project or folder', () => {
  assert.equal(systemProjectOf(system({ id: 'a', name: 'A', home: { repo: 'tidepool-web', directory: TIDEPOOL } })), TIDEPOOL);
  assert.equal(systemProjectOf(system({ id: 'b', name: 'B', sources: { code: { directory: SHOP, lastScan: '2026-10-01T10:00:00.000Z', partial: false, project: 'C:\\work\\other' }, brand: 0, description: false } })), 'C:\\work\\other');
  assert.equal(systemProjectOf(system({ id: 'c', name: 'C', sources: { code: { directory: SHOP, lastScan: '2026-10-01T10:00:00.000Z', partial: false }, brand: 0, description: false } })), SHOP);
  assert.equal(systemProjectOf(system({ id: 'd', name: 'D' })), null);
});

test('scopeSystems: all, one project, No project, and a folder (folders hold designs, not systems)', () => {
  const repo = system({ id: 'tidepool', name: 'Tidepool', home: { repo: 'tidepool-web', directory: TIDEPOOL } });
  const code = system({ id: 'shop-sys', name: 'Shop', sources: { code: { directory: SHOP, lastScan: '2026-10-01T10:00:00.000Z', partial: false }, brand: 0, description: false } });
  const loose = system({ id: 'harbor', name: 'Harbor' });
  const systems = [repo, code, loose];
  assert.deepEqual(scopeSystems(systems, ALL_SCOPE).map((s) => s.id), ['tidepool', 'shop-sys', 'harbor']);
  assert.deepEqual(scopeSystems(systems, { kind: 'project', directory: 'c:/users/you/work/shop' }).map((s) => s.id), ['shop-sys'], 'matched by sameDirectory');
  assert.deepEqual(scopeSystems(systems, { kind: 'no-project' }).map((s) => s.id), ['harbor']);
  assert.deepEqual(scopeSystems(systems, { kind: 'folder', id: 'f_aaaaaaaaaa' }), []);
});

test('libraryDesigns composes scope, then system, then search, then tab counts, then tab, then sort', () => {
  const designs = [
    design({ slug: 'alpha', title: 'Alpha', kind: 'canvas', projectDirectory: SHOP, system: link('harbor'), updated: '2026-10-27T10:00:00.000Z' }),
    design({ slug: 'beta', title: 'Beta', kind: 'page', projectDirectory: SHOP, system: link('harbor'), updated: '2026-10-26T10:00:00.000Z' }),
    design({ slug: 'gamma', title: 'Gamma', kind: 'canvas', projectDirectory: SHOP, system: link('tidepool'), updated: '2026-10-25T10:00:00.000Z' }),
    design({ slug: 'delta', title: 'Delta', kind: 'canvas', projectDirectory: null, system: link('harbor'), updated: '2026-10-24T10:00:00.000Z' }),
  ];
  const scope: ListScope = { kind: 'project', directory: SHOP };
  const filters = { query: '', tab: 'all' as const, system: { kind: 'system' as const, id: 'harbor' } };
  const r = libraryDesigns(designs, scope, folders, ROOT, filters, 'updated');
  assert.deepEqual(r.scoped.map((d) => d.slug), ['alpha', 'beta', 'gamma'], 'scope first');
  assert.deepEqual(r.shown.map((d) => d.slug), ['alpha', 'beta'], 'the system filter hides gamma; delta is out of scope');
  assert.deepEqual(r.counts, { all: 2, canvas: 1, page: 1 }, 'counts follow the system filter');
  const searched = libraryDesigns(designs, scope, folders, ROOT, { ...filters, query: 'alph' }, 'updated');
  assert.deepEqual(searched.counts, { all: 1, canvas: 1, page: 0 }, 'counts follow the search too');
  const paged = libraryDesigns(designs, scope, folders, ROOT, { ...filters, query: 'alph', tab: 'page' }, 'updated');
  assert.deepEqual(paged.shown, [], 'the tab hides the last row');
  assert.deepEqual(paged.counts, { all: 1, canvas: 1, page: 0 }, 'the tab never changes the counts');
  const byTitle = libraryDesigns(designs, scope, folders, ROOT, { query: '', tab: 'all', system: ALL_SYSTEMS }, 'title');
  assert.deepEqual(byTitle.shown.map((d) => d.slug), ['alpha', 'beta', 'gamma'], 'sort last, A–Z');
});

test('emptyStateOf: nothing written, an empty folder, and no matches with every filter named', () => {
  const one = design({ slug: 'coffee', title: 'Coffee subscription' });
  const filters = { query: 'hero', tab: 'page' as const, system: { kind: 'system' as const, id: 'speak' } };
  const systems = [system({ id: 'speak', name: 'Speak UI' })];
  const base = { all: [one], scoped: [one], shown: [], scope: { kind: 'folder' as const, id: 'f_aaaaaaaaaa' }, scopeLabel: 'Q4 launch', folderName: 'Q4 launch', filters, systems, draggable: true };
  assert.equal(emptyStateOf({ ...base, shown: [one] }), null, 'rows show: no empty state');

  const first = emptyStateOf({ ...base, all: [], scoped: [], shown: [] });
  assert.equal(first?.kind, 'no-designs');
  assert.equal(first?.action, 'new');
  assert.deepEqual(first?.chips, []);
  assert.match(first?.body ?? '', /the moment they are saved/, 'the page copy');
  assert.doesNotMatch(emptyStateOf({ ...base, all: [], scoped: [], shown: [], draggable: false })?.body ?? '', /the moment they are saved/, 'the rail copy is shorter');

  const emptyFolder = emptyStateOf({ ...base, scoped: [], shown: [], filters: { query: '', tab: 'all', system: ALL_SYSTEMS } });
  assert.equal(emptyFolder?.kind, 'folder-empty');
  assert.equal(emptyFolder?.title, 'No designs in Q4 launch yet');
  assert.equal(emptyFolder?.action, 'show-all');
  assert.match(emptyFolder?.body ?? '', /Drag designs here/);

  const noMatches = emptyStateOf(base);
  assert.equal(noMatches?.kind, 'no-matches');
  assert.equal(noMatches?.title, 'No designs in Q4 launch match “hero” with the Speak UI system.');
  assert.equal(noMatches?.body, 'Try another word, or clear the filters. Q4 launch stays selected.');
  assert.equal(noMatches?.action, 'clear-filters');
  assert.deepEqual(noMatches?.chips, [
    { id: 'scope', label: 'Folder: Q4 launch', fixed: true, icon: 'folder' },
    { id: 'search', label: 'Search: hero', fixed: false },
    { id: 'tab', label: 'Pages', fixed: false },
    { id: 'system', label: 'System: Speak UI', fixed: false },
  ], 'every active filter is named; the scope chip is the fixed one');
});

test('emptyStateOf: the tab-only and system-only sentences, and No project naming', () => {
  const one = design({ slug: 'coffee', title: 'Coffee subscription' });
  const base = { all: [one], scoped: [one], shown: [], scope: ALL_SCOPE, scopeLabel: null, folderName: null, systems: [], draggable: false };
  const tabOnly = emptyStateOf({ ...base, filters: { query: '', tab: 'canvas', system: ALL_SYSTEMS } });
  assert.equal(tabOnly?.title, 'Nothing in this tab yet');
  assert.equal(tabOnly?.body, 'Clear the filters to see what is here.');
  assert.deepEqual(tabOnly?.chips, [{ id: 'tab', label: 'Canvases', fixed: false }]);
  const noneSys = emptyStateOf({ ...base, scope: { kind: 'no-project' }, scopeLabel: 'No project', filters: { query: '', tab: 'all', system: { kind: 'none' } } });
  assert.equal(noneSys?.title, 'No designs in No project with no system.');
  assert.deepEqual(noneSys?.chips, [
    { id: 'scope', label: 'No project', fixed: true, icon: 'page' },
    { id: 'system', label: 'No system', fixed: false },
  ]);
  const projectScope = emptyStateOf({ ...base, scope: { kind: 'project', directory: SHOP }, scopeLabel: 'shop', filters: { query: '', tab: 'all', system: ALL_SYSTEMS } });
  assert.deepEqual(projectScope?.chips, [{ id: 'scope', label: 'Project: shop', fixed: true, icon: 'layers' }]);
});

test('the rail list title keeps its 120 px budget at 320 (L1a: the controls never squeeze it)', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/ui/styles.css', import.meta.url)), 'utf8');
  const rule = css.lastIndexOf('.dc-rail-title {');
  assert.ok(rule > -1, 'the rail title rule exists');
  const block = css.slice(rule, css.indexOf('}', rule));
  assert.match(block, /min-width:\s*120px/, 'the title keeps 120px; the head controls take the rest');
});
