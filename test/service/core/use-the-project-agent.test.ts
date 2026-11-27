// Use the project on the service side (documentation/specs/use-the-project-and-native-agent.md §1.5): the agent's view
// of a design that follows its project, the ask's recommendation for a registered repo system, and the per-project
// instruction line for a project-owned system.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildPinInstruction } from '../../../src/shared/agent/instructions.ts';
import type { SettingsFile, SystemDetail, SystemSummary } from '../../../src/shared/types.ts';
import { agentSystemOf, recommendedSystem } from '../../../src/service/agent-system.ts';
import type { Logger } from '../../../src/service/context.ts';
import { desiredPinTexts } from '../../../src/service/instructions.ts';

const AT = '2026-11-27T09:00:00.000Z';
const ROOT = path.resolve('/home/you/Documents/Designs');
const SHOP = path.resolve('/code/shop');
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const summary = (id: string, name: string, extra: Partial<SystemSummary> = {}): SystemSummary =>
  ({ id, name, status: 'ready', unreadable: null, updated: AT, home: 'internal', sources: { code: null, brand: 0, description: false }, ...extra }) as SystemSummary;
const repoHome = (directory: string): SystemSummary['home'] => ({ repo: path.basename(directory), directory });
const scannedFrom = (directory: string, project?: string): SystemSummary['sources'] => ({ code: { directory, lastScan: AT, partial: false, ...(project === undefined ? {} : { project }) }, brand: 0, description: false });

test('recommendedSystem: a registered repo system (no code source) is the project own; then the default', () => {
  const rows = [summary('acme', 'Acme'), summary('shop-ui', 'Shop UI', { home: repoHome('/code/shop') })];
  assert.equal(recommendedSystem(rows, '/code/shop', {}), 'shop-ui');
  // A chat opened in a package of the repo, and a repo inside the project, both count.
  assert.equal(recommendedSystem(rows, '/code/shop/packages/app', {}), 'shop-ui');
  assert.equal(recommendedSystem([summary('web', 'Web', { home: repoHome('/code/shop/web') })], '/code/shop', {}), 'web');
  assert.equal(recommendedSystem(rows, '/code/blog', { systemDefault: { choice: 'system', id: 'acme', name: 'Acme' } }), 'acme');
  assert.equal(recommendedSystem([summary('shop-ui', 'Shop UI', { home: repoHome('/code/shop'), unreadable: 'damaged' })], '/code/shop', {}), null, 'an unreadable system is never recommended');
});

test('agentSystemOf: a design that follows its project; a Draft own system is named; a copy still wins', async (t) => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dc-use-project-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const design = path.join(dir, 'pricing');
  await mkdir(design, { recursive: true });
  const record = (decision: 'project' | 'system' = 'project') =>
    ({ path: design, design: { projectDirectory: '/code/shop' }, state: { systemDecision: decision } }) as unknown as Parameters<typeof agentSystemOf>[1];
  let rows: SystemSummary[] = [summary('acme', 'Acme')];
  const deps = {
    systems: { list: async () => rows, filesDir: async (id: string) => path.join(dir, '_systems', id), detail: async () => ({ tokens: [] }) as unknown as SystemDetail },
    settings: () => ({}),
    log: quiet,
  };

  assert.deepEqual(await agentSystemOf(deps, record()), { state: 'project', draft: null });
  rows = [summary('acme', 'Acme'), summary('shop-ui', 'Shop UI', { status: 'draft', home: repoHome('/code/shop') })];
  assert.deepEqual(await agentSystemOf(deps, record()), { state: 'project', draft: { id: 'shop-ui', name: 'Shop UI' } });
  // A Ready own system that appeared later links nothing by itself: the design still follows the project.
  rows = [summary('shop-ui', 'Shop UI', { home: repoHome('/code/shop') }), summary('wip', 'Wip', { status: 'draft', sources: scannedFrom('/code/shop') })];
  assert.deepEqual(await agentSystemOf(deps, record()), { state: 'project', draft: null });
  // The systems list failing reads as no systems, not as an error.
  const broken = { ...deps, systems: { ...deps.systems, list: async (): Promise<SystemSummary[]> => { throw new Error('busy'); } } };
  assert.deepEqual(await agentSystemOf(broken, record()), { state: 'project', draft: null });

  // An unreadable copy still reads as none.
  await mkdir(path.join(design, 'system'), { recursive: true });
  await writeFile(path.join(design, 'system', 'COPY.json'), '{ broken');
  assert.deepEqual(await agentSystemOf(deps, record()), { state: 'none' });
});

test("agentSystemOf: a linked copy of the project's own system is marked; another system is not", async (t) => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dc-use-project-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const design = path.join(dir, 'pricing');
  await mkdir(path.join(design, 'system'), { recursive: true });
  const copy = (id: string, name: string) =>
    writeFile(path.join(design, 'system', 'COPY.json'), JSON.stringify({ v: 1, id, name, revision: 2, treeHash: 'a'.repeat(64), at: AT, by: 'creation', before: null, files: {} }));
  const record = { path: design, design: { projectDirectory: '/code/shop' }, state: { systemDecision: 'system' } } as unknown as Parameters<typeof agentSystemOf>[1];
  const rows = [summary('acme', 'Acme'), summary('shop-ui', 'Shop UI', { sources: scannedFrom('/code/shop/src', '/code/shop') })];
  const deps = {
    systems: { list: async () => rows, filesDir: async (id: string) => path.join(dir, '_systems', id), detail: async () => ({ tokens: [] }) as unknown as SystemDetail },
    settings: () => ({}),
    log: quiet,
  };
  await copy('shop-ui', 'Shop UI');
  const own = await agentSystemOf(deps, record);
  assert.equal(own.state === 'linked' && own.ownedByProject, true);
  await copy('acme', 'Acme');
  const other = await agentSystemOf(deps, record);
  assert.equal(other.state, 'linked');
  assert.equal(other.state === 'linked' && 'ownedByProject' in other, false);
});

test('desiredPinTexts: a project-owned Ready system gets its line with no pin; a pin keeps its old meaning', () => {
  const systems = [
    summary('acme', 'Acme'),
    summary('shop-ui', 'Shop UI', { home: repoHome('/code/shop') }),
    summary('blog-ui', 'Blog UI', { sources: scannedFrom('/code/blog') }),
    summary('wip', 'Wip', { status: 'draft', home: repoHome('/code/wip') }),
    summary('broken', 'Broken', { unreadable: 'damaged', home: repoHome('/code/broken') }),
    summary('inside', 'Inside', { sources: scannedFrom(`${ROOT}/sub`) }),
  ];
  const desired = (settings: Pick<SettingsFile, 'systemDefault' | 'systemPins'>) => desiredPinTexts({ settings, systems, designsRoot: ROOT });
  const BLOG = path.resolve('/code/blog');

  // No pins: one line per project-owned Ready, readable system outside the designs folder.
  assert.deepEqual([...desired({}).entries()], [
    [SHOP, buildPinInstruction('Shop UI')],
    [BLOG, buildPinInstruction('Blog UI')],
  ]);
  // A none pin takes the line away (the sync then sends "" for it); a system pin names its own system.
  assert.deepEqual([...desired({ systemPins: [{ directory: '/code/shop', choice: 'none' }] }).keys()], [BLOG]);
  assert.deepEqual(desired({ systemPins: [{ directory: '/code/shop', choice: 'system', id: 'acme', name: 'Acme' }] }).get(SHOP), buildPinInstruction('Acme'));
  // Use my default behaves as the old default pin: the default's line, or none.
  assert.equal(desired({ systemPins: [{ directory: '/code/shop', choice: 'follow-default' }] }).has(SHOP), false);
  assert.equal(desired({ systemPins: [{ directory: '/code/shop', choice: 'follow-default' }], systemDefault: { choice: 'system', id: 'acme', name: 'Acme' } }).get(SHOP), buildPinInstruction('Acme'));
});

test('desiredPinTexts: two systems for one project folder name the same pick as the chip rules', () => {
  const systems = [
    summary('old', 'Old', { home: repoHome('/code/shop'), updated: '2026-01-01T00:00:00.000Z' }),
    summary('new', 'New', { home: repoHome('/code/shop'), updated: '2026-11-01T00:00:00.000Z' }),
  ];
  assert.deepEqual([...desiredPinTexts({ settings: {}, systems, designsRoot: ROOT }).entries()], [[SHOP, buildPinInstruction('New')]]);
});
