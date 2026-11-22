// The agent's design.json `folderRequest` (documentation/specs/phase-2-6-technical.md §2.2, §5.4,
// AD-16): acted on once per distinct request, restart-safe; existing folders only, by name ignoring
// case; unknown names become a design warning and are never created; projects untouched; a damaged
// registry is never set aside by an agent request; the seen stamp is recorded before the write.
// Real settings, store and hub over a tmp root (the WP1 core harness).

import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { FolderRequest } from '../../src/shared/types.ts';
import { createFolderRequestReconciler, folderRequestStamp } from '../../src/service/folder-requests.ts';
import { ensureFoldersService } from '../../src/service/folders.ts';
import { createCore, type Core } from './core/harness.ts';

type Rig = { core: Core; file: string; slug: string; folders: ReturnType<typeof ensureFoldersService> };

const rig = async (t: TestContext): Promise<Rig> => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const design = await core.store.create({ kind: 'page', title: 'Pricing' });
  return { core, file: path.join(core.root, '.chamber', 'folders.json'), slug: design.slug, folders: ensureFoldersService(core.ctx) };
};

/** The agent's write: design.json gains (or changes) `folderRequest`, everything else kept. */
const agentWrites = async (core: Core, slug: string, folderRequest: unknown): Promise<void> => {
  const file = path.join(core.root, slug, 'design.json');
  const design = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  await writeFile(file, `${JSON.stringify({ ...design, folderRequest }, null, 2)}\n`);
};

const membersOf = async (rigged: Rig, name: string): Promise<string[] | undefined> => (await rigged.folders.list()).folders.find((folder) => folder.name === name)?.slugs;

test('acts once per request: a later user change sticks, and a restart does not act again', async (t) => {
  const r = await rig(t);
  await r.folders.create('Q4 launch');
  await agentWrites(r.core, r.slug, { add: ['q4 LAUNCH'] });
  const first = createFolderRequestReconciler({ ctx: r.core.ctx });
  t.after(() => first.stop());
  await first.reconcile(r.slug);
  assert.deepEqual(await membersOf(r, 'Q4 launch'), [r.slug]);
  const state = (await r.core.store.get(r.slug)).state;
  assert.equal(state.folderRequestSeen, folderRequestStamp({ add: ['q4 LAUNCH'] }));
  assert.equal(state.folderRequestProblem, undefined);

  // The user takes it out again; the same request (an echo, a restart) never re-adds it.
  const q4 = (await r.folders.list()).folders[0];
  assert.ok(q4);
  await r.folders.change(q4.id, { add: [], remove: [r.slug] });
  await first.reconcile(r.slug);
  first.stop();
  const restarted = createFolderRequestReconciler({ ctx: r.core.ctx });
  t.after(() => restarted.stop());
  await restarted.reconcile(r.slug);
  assert.deepEqual(await membersOf(r, 'Q4 launch'), []);

  // A distinct request (here a new `at`) is acted on.
  await agentWrites(r.core, r.slug, { add: ['Q4 launch'], at: '2026-11-22T10:04:00Z' });
  await restarted.reconcile(r.slug);
  assert.deepEqual(await membersOf(r, 'Q4 launch'), [r.slug]);
});

test('unknown names are never created; they become a design warning that a clean request clears', async (t) => {
  const r = await rig(t);
  await r.folders.create('Ideas');
  await agentWrites(r.core, r.slug, { add: ['Ideas', 'Q4', 'Launch'], remove: ['Old'] });
  const reconciler = createFolderRequestReconciler({ ctx: r.core.ctx });
  t.after(() => reconciler.stop());
  await reconciler.reconcile(r.slug);

  assert.deepEqual((await r.folders.list()).folders.map((folder) => [folder.name, folder.slugs]), [['Ideas', [r.slug]]]);
  const record = await r.core.store.get(r.slug);
  assert.deepEqual(record.state.folderRequestProblem, { unknown: ['Q4', 'Launch'] });
  const warning = record.warnings.find((entry) => entry.code === 'folder-request-unknown');
  assert.deepEqual(warning, {
    code: 'folder-request-unknown',
    field: 'folderRequest',
    message: 'The agent asked to add this design to Q4 and Launch, but there are no folders with those names.',
  });

  await agentWrites(r.core, r.slug, { remove: ['Ideas'] });
  await reconciler.reconcile(r.slug);
  const cleared = await r.core.store.get(r.slug);
  assert.equal(cleared.state.folderRequestProblem, undefined);
  assert.equal(cleared.warnings.some((entry) => entry.code === 'folder-request-unknown'), false);
  assert.deepEqual(await membersOf(r, 'Ideas'), []);
});

test('one unknown name reads in the singular', async (t) => {
  const r = await rig(t);
  await agentWrites(r.core, r.slug, { add: ['Q4'] });
  const reconciler = createFolderRequestReconciler({ ctx: r.core.ctx });
  t.after(() => reconciler.stop());
  await reconciler.reconcile(r.slug);
  assert.equal(
    (await r.core.store.get(r.slug)).warnings.find((entry) => entry.code === 'folder-request-unknown')?.message,
    "The agent asked to add this design to Q4, but there's no folder with that name.",
  );
  // No registry existed: nothing was made for it.
  await assert.rejects(readFile(r.file), { code: 'ENOENT' });
});

test('a damaged registry is never set aside by an agent request; the request waits and lands once it is fixed', async (t) => {
  const r = await rig(t);
  await mkdir(path.dirname(r.file), { recursive: true });
  await writeFile(r.file, '{ damaged');
  await agentWrites(r.core, r.slug, { add: ['Q4'] });
  const reconciler = createFolderRequestReconciler({ ctx: r.core.ctx });
  t.after(() => reconciler.stop());
  await reconciler.reconcile(r.slug);

  assert.equal(await readFile(r.file, 'utf8'), '{ damaged');
  assert.deepEqual(await readdir(path.dirname(r.file)), ['folders.json']);
  assert.equal((await r.core.store.get(r.slug)).state.folderRequestSeen, undefined);
  assert.ok(r.core.logs.some((line) => line.event === 'folders.request-waiting'));

  // The user's next folder action sets the file aside; the next design event applies the request.
  await r.folders.create('Q4');
  await reconciler.reconcile(r.slug);
  assert.deepEqual(await membersOf(r, 'Q4'), [r.slug]);
});

test('the seen stamp is recorded before the folders write, so a failing write never loops', async (t) => {
  const r = await rig(t);
  await agentWrites(r.core, r.slug, { add: ['Q4'] });
  let calls = 0;
  const reconciler = createFolderRequestReconciler({
    ctx: r.core.ctx,
    folders: {
      changeByName: async () => {
        calls += 1;
        throw new Error('disk gone');
      },
    },
  });
  t.after(() => reconciler.stop());
  await reconciler.reconcile(r.slug);
  await reconciler.reconcile(r.slug);
  assert.equal(calls, 1);
  assert.equal((await r.core.store.get(r.slug)).state.folderRequestSeen, folderRequestStamp({ add: ['Q4'] }));
  assert.ok(r.core.logs.some((line) => line.event === 'folders.request-failed'));
});

test('manual project members are never touched by an agent request', async (t) => {
  const r = await rig(t);
  await r.folders.create('Q4');
  const shop = r.core.tmp.at('work/shop');
  await r.folders.changeMany([{ target: { kind: 'project', directory: shop }, add: [r.slug], remove: [] }], { atomic: false });
  // A project path written as a folder name is only a name: unknown, never a project target.
  await agentWrites(r.core, r.slug, { add: ['Q4', shop.slice(0, 40)], remove: [] });
  const reconciler = createFolderRequestReconciler({ ctx: r.core.ctx });
  t.after(() => reconciler.stop());
  await reconciler.reconcile(r.slug);
  const list = await r.folders.list();
  assert.deepEqual(list.projects, [{ directory: shop, slugs: [r.slug] }]);
  assert.deepEqual(list.folders.map((folder) => folder.name), ['Q4']);
});

test('design events drive it; the user\'s own events and an unparseable design.json never act', async (t) => {
  const r = await rig(t);
  await r.folders.create('Q4');
  const reconciler = createFolderRequestReconciler({ ctx: r.core.ctx });
  t.after(() => reconciler.stop());

  await writeFile(path.join(r.core.root, r.slug, 'design.json'), '{ "folderRequest": { "add": ["Q4"] ');
  r.core.ctx.hub.emit({ slug: r.slug, kind: 'design' });
  await reconciler.idle();
  assert.deepEqual(await membersOf(r, 'Q4'), []);

  await writeFile(path.join(r.core.root, r.slug, 'design.json'), `${JSON.stringify({ version: 1, kind: 'page', title: 'Pricing', folderRequest: { add: ['Q4'] } })}\n`);
  r.core.ctx.hub.emit({ slug: r.slug, kind: 'design', origin: 'user' });
  await reconciler.idle();
  assert.deepEqual(await membersOf(r, 'Q4'), []);

  r.core.ctx.hub.emit({ slug: r.slug, kind: 'design' });
  await reconciler.idle();
  assert.deepEqual(await membersOf(r, 'Q4'), [r.slug]);
});

test('the stamp is the canonical request: key order and absent lists do not matter, `at` does', () => {
  const a: FolderRequest = { add: ['Q4'] };
  const b: FolderRequest = { remove: [], add: ['Q4'] };
  assert.equal(folderRequestStamp(a), folderRequestStamp(b));
  assert.notEqual(folderRequestStamp(a), folderRequestStamp({ add: ['Q4'], at: '2026-11-22T10:04:00Z' }));
  assert.match(folderRequestStamp(a), /^[0-9a-f]{64}$/);
});
