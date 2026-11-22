import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProjectMembersView } from '../../src/shared/api.ts';
import type { DesignSummary } from '../../src/shared/types.ts';
import {
  SEARCH_AFTER,
  filingOf,
  filingProblem,
  filterRows,
  goesLine,
  keyOfTarget,
  pickerTargets,
  showSearch,
  statedResult,
  targetOfKey,
  type PickRow,
  type PickerInput,
  type TargetKey,
} from '../../src/ui/model/folder-picker-model.ts';
import type { FolderLite, ProjectInfo } from '../../src/ui/model/list-model.ts';

const ROOT = 'C:\\Users\\you\\Documents\\Designs';
const SHOP = 'C:\\Users\\you\\work\\shop';
const MYCHAMBA = 'C:\\Users\\you\\work\\mychamba';
const APP_WORK = 'C:\\Users\\you\\work\\app';
const APP_PERSONAL = 'C:\\Users\\you\\personal\\app';

const design = (slug: string, projectDirectory: string | null = SHOP): DesignSummary => ({
  slug,
  kind: 'canvas',
  title: slug,
  created: '2026-11-01T10:00:00.000Z',
  updated: '2026-11-01T10:00:00.000Z',
  pending: false,
  screenCount: 2,
  viewports: [],
  sessionId: null,
  projectDirectory,
  openComments: 0,
  thumb: { state: 'ready', key: null },
  warnings: [],
});

const folder = (id: string, name: string, slugs: string[]): FolderLite => ({ id, name, slugs });

const input = (over: Partial<PickerInput> = {}): PickerInput => ({
  folders: [],
  projectMembers: [],
  hostProjects: [],
  designs: [design('pricing'), design('checkout'), design('invoice', null)],
  designsRoot: ROOT,
  design: { slug: 'pricing', projectDirectory: SHOP },
  derivedProject: null,
  ...over,
});

const rowOf = (rows: readonly PickRow[], key: string): PickRow => {
  const found = rows.find((row) => row.key === key);
  assert.ok(found, `row ${key} exists`);
  return found;
};

test('folders sort by name and count only live members; the design’s own folders are ticked', () => {
  const view = pickerTargets(input({
    folders: [folder('f_b', 'Q4 launch', ['pricing', 'gone-design']), folder('f_a', 'Archive', ['checkout']), folder('f_c', 'Explorations', [])],
  }));
  assert.deepEqual(view.folders.map((row) => row.label), ['Archive', 'Explorations', 'Q4 launch']);
  assert.deepEqual(view.folders.map((row) => row.count), [1, 0, 1]);
  assert.equal(rowOf(view.folders, 'folder:f_b').checked, true);
  assert.equal(rowOf(view.folders, 'folder:f_a').checked, false);
  assert.equal(view.total, 4); // three folders and the derived shop project
});

test('projects are the union of derived groups, registry members and host projects, matched by sameDirectory', () => {
  const view = pickerTargets(input({
    designs: [design('pricing'), design('checkout', SHOP.toLowerCase().replace('work', 'Work')), design('manual-only', MYCHAMBA), design('invoice', null)],
    projectMembers: [{ directory: MYCHAMBA, slugs: ['pricing'] }, { directory: 'C:\\Users\\you\\work\\registry-only', slugs: ['checkout'] }],
    hostProjects: [{ directory: SHOP, name: 'Shop' }, { directory: 'C:\\Users\\you\\work\\host-only', name: 'Host only' }],
  }));
  const labels = view.projects.map((row) => row.label);
  assert.deepEqual(labels, ['Host only', 'mychamba', 'registry-only', 'Shop']);
  // The re-cased derived spelling merges into the one shop row (host name wins).
  assert.equal(view.projects.filter((row) => row.label === 'Shop').length, 1);
  assert.equal(rowOf(view.projects, `project:${SHOP}`).count, 2);
});

test('a project’s count is its derived and manual live members together, never doubled', () => {
  const members: ProjectMembersView[] = [{ directory: MYCHAMBA, slugs: ['pricing', 'checkout', 'gone-design'] }];
  const view = pickerTargets(input({
    designs: [design('pricing', MYCHAMBA), design('checkout', SHOP), design('invoice', null)],
    projectMembers: members,
    design: { slug: 'checkout', projectDirectory: SHOP },
  }));
  const row = rowOf(view.projects, `project:${MYCHAMBA}`);
  assert.equal(row.count, 2); // pricing (derived there) + checkout (manual); gone-design is not live
  assert.equal(row.checked, true); // checkout is a manual member
  assert.equal(row.locked, false);
});

test('two projects with the same name tell apart by their parent folder', () => {
  const view = pickerTargets(input({
    designs: [design('a', APP_WORK), design('b', APP_PERSONAL)],
    hostProjects: [],
    design: null,
    derivedProject: null,
  }));
  assert.deepEqual(view.projects.map((row) => row.label), ['app · personal', 'app · work']);
});

test('a project at or inside the designs root is left out', () => {
  const view = pickerTargets(input({
    designs: [design('pricing', SHOP), design('inside', `${ROOT}\\nested`), design('at-root', ROOT)],
    projectMembers: [{ directory: `${ROOT}\\nested`, slugs: ['pricing'] }],
    hostProjects: [{ directory: ROOT, name: 'Designs' }],
  }));
  assert.deepEqual(view.projects.map((row) => row.label), ['shop']);
});

test('the design’s derived project is ticked and locked; a manual member is ticked and free', () => {
  const view = pickerTargets(input({ projectMembers: [{ directory: MYCHAMBA, slugs: ['pricing'] }] }));
  const derived = rowOf(view.projects, `project:${SHOP}`);
  assert.equal(derived.checked, true);
  assert.equal(derived.locked, true);
  assert.equal(derived.lockedReason, 'Made for this project');
  const manual = rowOf(view.projects, `project:${MYCHAMBA}`);
  assert.equal(manual.checked, true);
  assert.equal(manual.locked, false);
  assert.equal(manual.lockedReason, null);
});

test('a design with no project locks nothing', () => {
  const view = pickerTargets(input({ design: { slug: 'invoice', projectDirectory: null } }));
  assert.ok(view.projects.every((row) => !row.locked && !row.checked));
});

test('the New dialog locks the chat’s project with its own reason and ticks nothing else', () => {
  const view = pickerTargets(input({
    design: null,
    derivedProject: SHOP,
    folders: [folder('f_a', 'Q4 launch', ['pricing'])],
    projectMembers: [{ directory: MYCHAMBA, slugs: ['pricing'] }],
  }));
  const derived = rowOf(view.projects, `project:${SHOP}`);
  assert.equal(derived.checked, true);
  assert.equal(derived.locked, true);
  assert.equal(derived.lockedReason, 'This design is made for it');
  assert.equal(rowOf(view.projects, `project:${MYCHAMBA}`).checked, false);
  assert.equal(rowOf(view.folders, 'folder:f_a').checked, false);
});

test('the New dialog’s chat project appears even with no designs in it yet', () => {
  const view = pickerTargets(input({ designs: [], design: null, derivedProject: MYCHAMBA }));
  assert.deepEqual(view.projects.map((row) => row.label), ['mychamba']);
  assert.equal(view.projects[0]?.locked, true);
});

test('exclude leaves the Move source out of both sections', () => {
  const view = pickerTargets(input({
    folders: [folder('f_a', 'Q4 launch', ['pricing'])],
    projectMembers: [{ directory: MYCHAMBA, slugs: ['pricing'] }],
    exclude: 'folder:f_a',
  }));
  assert.deepEqual(view.folders, []);
  assert.equal(view.total, 2); // shop and mychamba
  const fromProject = pickerTargets(input({ projectMembers: [{ directory: MYCHAMBA, slugs: ['pricing'] }], exclude: `project:${MYCHAMBA}` }));
  assert.ok(fromProject.projects.every((row) => row.key !== `project:${MYCHAMBA}`));
});

test('filterRows matches the label ignoring case; showSearch appears past 8 targets', () => {
  const rows = pickerTargets(input({ folders: [folder('f_a', 'Q4 launch', []), folder('f_b', 'Explorations', [])] })).folders;
  assert.deepEqual(filterRows(rows, 'q4').map((row) => row.label), ['Q4 launch']);
  assert.deepEqual(filterRows(rows, '  ').map((row) => row.label), ['Explorations', 'Q4 launch']);
  assert.deepEqual(filterRows(rows, 'zzz'), []);
  assert.equal(SEARCH_AFTER, 8);
  assert.equal(showSearch(8), false);
  assert.equal(showSearch(9), true);
});

test('statedResult names one, two, or the first two and the rest', () => {
  const rows = ['Q4 launch', 'Explorations', 'Archive', 'Handoff'].map((label, index): PickRow => ({
    key: `folder:f_${index}`, kind: 'folder', label, title: label, count: 0, checked: true, locked: false, lockedReason: null,
  }));
  assert.equal(statedResult([]), null);
  assert.equal(statedResult(rows.slice(0, 1)), 'Goes into Q4 launch');
  assert.equal(statedResult(rows.slice(0, 2)), 'Goes into Q4 launch and Explorations');
  assert.equal(statedResult(rows.slice(0, 3)), 'Goes into Q4 launch, Explorations and 1 more');
  assert.equal(statedResult(rows), 'Goes into Q4 launch, Explorations and 2 more');
});

test('goesLine adds the automatic project and the way to change it', () => {
  const pick: PickRow = { key: 'folder:f_a', kind: 'folder', label: 'Q4 launch', title: 'Q4 launch', count: 0, checked: true, locked: false, lockedReason: null };
  assert.equal(goesLine([], null), null);
  assert.equal(goesLine([], 'SpeakAppi'), 'It also lands in SpeakAppi on its own. You can change this later.');
  assert.equal(goesLine([pick], null), 'Goes into Q4 launch. You can change this later.');
  assert.equal(goesLine([pick], 'SpeakAppi'), 'Goes into Q4 launch. It also lands in SpeakAppi on its own. You can change this later.');
});

test('keys and targets round-trip for both kinds', () => {
  assert.equal(keyOfTarget({ kind: 'folder', id: 'f_0000000001' }), 'folder:f_0000000001');
  assert.equal(keyOfTarget({ kind: 'project', directory: SHOP }), `project:${SHOP}`);
  assert.deepEqual(targetOfKey('folder:f_0000000001'), { kind: 'folder', id: 'f_0000000001' });
  assert.deepEqual(targetOfKey(`project:${SHOP}`), { kind: 'project', directory: SHOP });
});

test('filingOf splits the keys and is undefined when nothing is picked', () => {
  assert.equal(filingOf([]), undefined);
  assert.deepEqual(filingOf(['folder:f_a', `project:${SHOP}`, 'folder:f_b']), { folders: ['f_a', 'f_b'], projects: [SHOP] });
  assert.deepEqual(filingOf([`project:${SHOP}`]), { projects: [SHOP] });
});

test('filingProblem names the cap a pick breaks, and nothing under the caps', () => {
  assert.equal(filingProblem([]), null);
  assert.equal(filingProblem(['folder:f_a', `project:${SHOP}`]), null);
  const manyProjects = Array.from({ length: 15 }, (_, index): TargetKey => `project:C:\\work\\p${index}`);
  assert.match(filingProblem(manyProjects) ?? '', /up to 14 projects/);
  const manyFolders = Array.from({ length: 50 }, (_, index): TargetKey => `folder:f_${String(index).padStart(10, '0')}`);
  assert.match(filingProblem([...manyFolders, ...manyProjects.slice(0, 15)]) ?? '', /up to 14 projects/);
  assert.match(filingProblem([...manyFolders, ...manyProjects.slice(0, 14), 'folder:f_extra']) ?? '', /up to 64 folders and projects/);
});
