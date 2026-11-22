// Manual folders (Phase 2.5 G1; documentation/specs/phase-2-5-technical.md §2.8, §3.3, §5.8): the
// registry parse and its damaged recovery, set semantics, slug+created keying, prune on removed,
// soft delete and undelete, a root change, multi-folder membership, and the routes behind the
// bearer token. Real settings, store and hub over a tmp root (the WP1 core harness).

import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { ApiErrorBody, DeleteFolderResponse, DesignListResponse, FolderListResponse, FolderResponse } from '../../../src/shared/api.ts';
import { FOLDER_UNDO_MS, FOLDERS_MAX } from '../../../src/shared/limits.ts';
import type { DesignSummary } from '../../../src/shared/types.ts';
import {
  applyMembership,
  cleanRegistry,
  createFoldersService,
  createProjectFolderStats,
  FOLDER_NAME_EMPTY,
  FOLDERS_FULL,
  mintFolderId,
  normalizeFolderName,
  parseFolderChange,
  parseFoldersRegistry,
  type FoldersRegistry,
  type FoldersService,
} from '../../../src/service/folders.ts';
import { ApiError } from '../../../src/service/http.ts';
import { registerFoldersRoutes } from '../../../src/service/routes/folders.ts';
import { createCore, serveCore, type Core } from './harness.ts';

const T0 = '2026-11-01T10:00:00.000Z';
const registryOf = (folders: FoldersRegistry['folders'], rev = 1): FoldersRegistry => ({ v: 1, rev, folders });
const folder = (id: string, name: string, designs: { slug: string; created: string }[] = [], deleted: string | null = null) => ({ id, name, created: T0, deleted, designs });

describe('folders: pure parts', () => {
  test('a valid registry parses; anything wrong reads as null (damaged)', () => {
    const good = registryOf([folder('f_aaaaaaaaaa', 'Launch', [{ slug: 'checkout', created: T0 }])], 3);
    assert.deepEqual(parseFoldersRegistry(JSON.stringify(good)), good);
    for (const bad of [
      '{',
      'null',
      '[]',
      JSON.stringify({ ...good, v: 2 }),
      JSON.stringify({ ...good, rev: -1 }),
      JSON.stringify({ ...good, folders: {} }),
      JSON.stringify(registryOf([folder('F_AAAAAAAAAA', 'Launch')])),
      JSON.stringify(registryOf([folder('f_aaaaaaaaaa', '   ')])),
      JSON.stringify(registryOf([folder('f_aaaaaaaaaa', 'x'.repeat(41))])),
      JSON.stringify(registryOf([folder('f_aaaaaaaaaa', 'A'), folder('f_aaaaaaaaaa', 'B')])),
      JSON.stringify(registryOf([folder('f_aaaaaaaaaa', 'A', [{ slug: '../etc', created: T0 }])])),
      JSON.stringify(registryOf([{ ...folder('f_aaaaaaaaaa', 'A'), deleted: 'yesterday' }])),
    ]) {
      assert.equal(parseFoldersRegistry(bad), null, bad.slice(0, 80));
    }
  });

  test('names are NFKC, trimmed, 1..40, without control characters', () => {
    assert.equal(normalizeFolderName('  Q4 launch  '), 'Q4 launch');
    assert.equal(normalizeFolderName('ＡＢＣ'), 'ABC');
    for (const bad of ['', '   ', 'a\nb', 'x'.repeat(41), 42, null]) {
      assert.throws(() => normalizeFolderName(bad), (error: unknown) => error instanceof ApiError && error.code === 'bad-request');
    }
    assert.throws(() => normalizeFolderName(' '), { message: FOLDER_NAME_EMPTY });
  });

  test('set semantics: add twice is one entry, a stale created is replaced, unknown slugs are skipped', () => {
    const live = new Map([['checkout', T0], ['hero', '2026-11-02T00:00:00.000Z']]);
    const start = folder('f_aaaaaaaaaa', 'A', [{ slug: 'hero', created: '2020-01-01T00:00:00.000Z' }]);
    const once = applyMembership(start, { add: ['checkout', 'checkout', 'hero', 'ghost'], remove: [] }, live);
    const twice = applyMembership(once, { add: ['checkout', 'hero'], remove: [] }, live);
    assert.deepEqual(twice.designs, [
      { slug: 'checkout', created: T0 },
      { slug: 'hero', created: '2026-11-02T00:00:00.000Z' },
    ]);
    assert.deepEqual(applyMembership(twice, { add: [], remove: ['hero', 'ghost'] }, live).designs, [{ slug: 'checkout', created: T0 }]);
  });

  test('clean drops entries whose slug+created no longer match and folders deleted past the undo window', () => {
    const now = Date.parse(T0) + FOLDER_UNDO_MS + 1;
    const live = new Map([['checkout', T0]]);
    const { registry, changed } = cleanRegistry(
      registryOf([
        folder('f_aaaaaaaaaa', 'Kept', [{ slug: 'checkout', created: T0 }, { slug: 'checkout', created: '2020-01-01T00:00:00.000Z' }, { slug: 'gone', created: T0 }]),
        folder('f_bbbbbbbbbb', 'Expired', [], T0),
        folder('f_cccccccccc', 'Recent', [], new Date(now - 1000).toISOString()),
      ]),
      live,
      now,
    );
    assert.equal(changed, true);
    assert.deepEqual(registry.folders.map((entry) => entry.id), ['f_aaaaaaaaaa', 'f_cccccccccc']);
    assert.deepEqual(registry.folders[0]?.designs, [{ slug: 'checkout', created: T0 }]);
    assert.equal(cleanRegistry(registry, live, now).changed, false);
  });

  test('change bodies are bounded; non-slug strings are skipped like unknown slugs', () => {
    assert.deepEqual(parseFolderChange({ add: ['a', '../x', 'B'] }), { add: ['a'], remove: [] });
    for (const bad of [null, [], { add: 'a' }, { add: Array.from({ length: 201 }, () => 'a') }, { remove: [1] }, { add: ['a'], remove: ['a'] }]) {
      assert.throws(() => parseFolderChange(bad), (error: unknown) => error instanceof ApiError && error.code === 'bad-request');
    }
  });

  test('ids match the folder id pattern', () => {
    for (let i = 0; i < 50; i += 1) assert.match(mintFolderId(), /^f_[a-z0-9]{10}$/);
  });
});

// ---- the service over a real store ----

type Rig = { core: Core; folders: FoldersService; file: string; at: { now: Date } };

const rig = async (t: TestContext): Promise<Rig> => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const at = { now: new Date('2026-11-19T12:00:00.000Z') };
  const folders = createFoldersService({ settings: core.ctx.settings, hub: core.ctx.hub, store: core.ctx.store, log: core.ctx.log, now: () => at.now });
  t.after(() => folders.dispose());
  return { core, folders, file: path.join(core.root, '.chamber', 'folders.json'), at };
};

const onDisk = async (file: string): Promise<FoldersRegistry> => JSON.parse(await readFile(file, 'utf8')) as FoldersRegistry;

describe('folders: service', () => {
  test('create, rename, a design in several folders, and a title rename keeps membership', async (t) => {
    const { core, folders, file } = await rig(t);
    const checkout = await core.store.create({ kind: 'page', title: 'Checkout' });
    const launch = await folders.create('Launch');
    const q4 = await folders.create('Q4');
    await folders.change(launch.id, { add: [checkout.slug], remove: [] });
    await folders.change(q4.id, { add: [checkout.slug], remove: [] });
    await core.store.patch(checkout.slug, { title: 'Checkout, calmer' });
    const renamed = await folders.rename(launch.id, 'Launch week');

    assert.equal(renamed.name, 'Launch week');
    const list = await folders.list();
    assert.deepEqual(list.folders.map((entry) => [entry.name, entry.slugs]), [['Launch week', [checkout.slug]], ['Q4', [checkout.slug]]]);
    const registry = await onDisk(file);
    assert.equal(registry.rev, 5);
    assert.deepEqual(registry.folders[0]?.designs, [{ slug: checkout.slug, created: checkout.design.created }]);
    // Grouping never touches the design's folder.
    assert.deepEqual((await readdir(core.root)).sort(), ['.chamber', checkout.slug].sort());
  });

  test('names are unique ignoring case; the cap is 50 live folders', async (t) => {
    const { folders } = await rig(t);
    const a = await folders.create('Launch');
    await assert.rejects(folders.create('launch'), { code: 'conflict', message: 'You already have a folder called Launch.' });
    const b = await folders.create('Other');
    await assert.rejects(folders.rename(b.id, 'LAUNCH'), { code: 'conflict' });
    assert.equal((await folders.rename(a.id, 'LAUNCH')).name, 'LAUNCH');
    for (let i = 2; i < FOLDERS_MAX; i += 1) await folders.create(`F${i}`);
    await assert.rejects(folders.create('One more'), { code: 'conflict', message: FOLDERS_FULL });
  });

  test('two windows adding the same design at once end with one entry', async (t) => {
    const { core, folders, file } = await rig(t);
    const design = await core.store.create({ kind: 'canvas', title: 'Wall' });
    const target = await folders.create('Both');
    await Promise.all([folders.change(target.id, { add: [design.slug], remove: [] }), folders.change(target.id, { add: [design.slug], remove: [] })]);
    assert.deepEqual((await onDisk(file)).folders[0]?.designs.map((entry) => entry.slug), [design.slug]);
  });

  test('a later design reusing a slug is not in the folder (slug + created)', async (t) => {
    const { core, folders } = await rig(t);
    const target = await folders.create('Old');
    await core.tmp.writeDesign('designs/reuse', { 'design.json': { version: 1, kind: 'page', title: 'First', created: '2026-01-01T00:00:00.000Z' } });
    await folders.change(target.id, { add: ['reuse'], remove: [] });
    assert.deepEqual((await folders.list()).folders[0]?.slugs, ['reuse']);
    await rm(path.join(core.root, 'reuse'), { recursive: true });
    await core.tmp.writeDesign('designs/reuse', { 'design.json': { version: 1, kind: 'page', title: 'Second', created: '2026-06-01T00:00:00.000Z' } });
    assert.deepEqual((await folders.list()).folders[0]?.slugs, []);
  });

  test('a removed design leaves every folder on the removed event (one write)', async (t) => {
    const { core, folders, file } = await rig(t);
    const keep = await core.store.create({ kind: 'page', title: 'Keep' });
    const drop = await core.store.create({ kind: 'page', title: 'Drop' });
    const a = await folders.create('A');
    const b = await folders.create('B');
    await folders.change(a.id, { add: [keep.slug, drop.slug], remove: [] });
    await folders.change(b.id, { add: [drop.slug], remove: [] });
    const before = (await onDisk(file)).rev;
    const events: string[] = [];
    core.ctx.hub.subscribe((event) => void events.push(event.kind));

    await core.store.trash(drop.slug);
    await folders.dispose(); // settles the queued prune
    const after = await onDisk(file);
    assert.equal(after.rev, before + 1);
    assert.deepEqual(after.folders.map((entry) => entry.designs.map((design) => design.slug)), [[keep.slug], []]);
    assert.ok(events.includes('folders'));
  });

  test('soft delete hides the folder and keeps its designs; undelete brings it back within the hour', async (t) => {
    const { core, folders, at } = await rig(t);
    const design = await core.store.create({ kind: 'page', title: 'Page' });
    const target = await folders.create('Launch');
    await folders.change(target.id, { add: [design.slug], remove: [] });

    assert.equal(await folders.remove(target.id), 1);
    assert.deepEqual((await folders.list()).folders, []);
    await assert.rejects(folders.change(target.id, { add: [], remove: [] }), { code: 'not-found' });
    // The name is free while deleted; undelete then refuses the clash.
    const clash = await folders.create('launch');
    await assert.rejects(folders.undelete(target.id), { code: 'conflict' });
    await folders.remove(clash.id);
    assert.deepEqual((await folders.undelete(target.id)).slugs, [design.slug]);
    assert.deepEqual((await folders.list()).folders.map((entry) => entry.name), ['Launch']);

    await folders.remove(target.id);
    at.now = new Date(at.now.getTime() + FOLDER_UNDO_MS + 1000);
    await assert.rejects(folders.undelete(target.id), { code: 'not-found', message: "That folder can't be brought back any more." });
    await assert.rejects(folders.remove('f_zzzzzzzzzz'), { code: 'not-found' });
  });

  test('a damaged registry reads as damaged, a prune leaves it, the first user action sets it aside', async (t) => {
    const { core, folders, file } = await rig(t);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{ not json');
    assert.deepEqual(await folders.list(), { folders: [], projects: [], damaged: true });
    await folders.prune();
    assert.equal(await readFile(file, 'utf8'), '{ not json');

    await folders.create('Fresh');
    const names = await readdir(path.dirname(file));
    const aside = names.find((name) => /^folders\.damaged-\d{14}\.json$/.test(name));
    assert.ok(aside, names.join(', '));
    assert.equal(await readFile(path.join(core.root, '.chamber', aside), 'utf8'), '{ not json');
    assert.deepEqual((await folders.list()).folders.map((entry) => entry.name), ['Fresh']);
    assert.equal((await onDisk(file)).rev, 1);
  });

  test('a registry over 1 MiB or a link reads as damaged', async (t) => {
    const { core, folders, file } = await rig(t);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, ' '.repeat(1_048_577));
    assert.equal((await folders.list()).damaged, true);
    await rm(file);
    const outside = core.tmp.at('outside.json');
    await writeFile(outside, JSON.stringify(registryOf([])));
    try {
      await symlink(outside, file);
    } catch (error) {
      t.skip(`symlinks unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    assert.equal((await folders.list()).damaged, true);
  });

  test('a root change reads the new root fresh and never moves the old file', async (t) => {
    const { core, folders } = await rig(t);
    await folders.create('In A');
    const oldFile = path.join(core.root, '.chamber', 'folders.json');
    const before = await readFile(oldFile, 'utf8');
    const rootB = core.tmp.at('designs-b');
    await mkdir(rootB);
    await core.ctx.settings.update({ root: rootB });

    assert.deepEqual(await folders.list(), { folders: [], projects: [] });
    await folders.create('In B');
    assert.equal(await readFile(oldFile, 'utf8'), before);
    assert.deepEqual((await onDisk(path.join(rootB, '.chamber', 'folders.json'))).folders.map((entry) => entry.name), ['In B']);

    await core.ctx.settings.update({ root: core.root });
    assert.deepEqual((await folders.list()).folders.map((entry) => entry.name), ['In A']);
  });

  test('a missing root lists no folders and a write refuses without creating it', async (t) => {
    const { core, folders } = await rig(t);
    const gone = core.tmp.at('not-there');
    await core.ctx.settings.update({ root: gone }).catch(() => undefined);
    if (core.ctx.settings.root() !== gone) {
      t.skip('settings refuse a missing root here');
      return;
    }
    await rm(gone, { recursive: true, force: true });
    assert.deepEqual(await folders.list(), { folders: [], projects: [] });
    await assert.rejects(folders.create('X'), { code: 'bad-path' });
    await assert.rejects(readdir(gone), { code: 'ENOENT' });
  });
});

// ---- project folders for GET /designs ----

describe('folders: projectFolders', () => {
  const summary = (slug: string, projectDirectory: string | null) => ({ slug, projectDirectory }) as DesignSummary;

  test('distinct directories in list order, stat-ed once a minute, relative and UNC never stat-ed', async () => {
    let clock = 0;
    const calls: string[] = [];
    const stats = createProjectFolderStats({
      now: () => clock,
      isDirectory: async (directory) => {
        calls.push(directory);
        return directory === '/work/shop';
      },
    });
    const designs = [
      summary('a', '/work/shop'),
      summary('b', '/work/shop/'),
      summary('c', null),
      summary('d', '/work/gone'),
      summary('e', 'relative/dir'),
      summary('f', '\\\\server\\share'),
    ];
    assert.deepEqual(await stats(designs), [
      { directory: '/work/shop', exists: true },
      { directory: '/work/gone', exists: false },
      { directory: 'relative/dir', exists: false },
      { directory: '\\\\server\\share', exists: true },
    ]);
    assert.deepEqual(calls, ['/work/shop', '/work/gone']);
    await stats(designs);
    assert.equal(calls.length, 2);
    clock = 60_001;
    await stats(designs);
    assert.equal(calls.length, 4);
  });

  test('at most 100 directories', async () => {
    const stats = createProjectFolderStats({ isDirectory: async () => true });
    const designs = Array.from({ length: 150 }, (_unused, i) => summary(`d${i}`, `/p/${i}`));
    assert.equal((await stats(designs)).length, 100);
  });
});

// ---- routes ----

describe('folders: routes', () => {
  const served = async (t: TestContext) => {
    const core = await createCore(t);
    t.after(() => core.stop());
    const server = await serveCore(t, core);
    registerFoldersRoutes(server.router, core.ctx);
    return server;
  };

  test('a missing or wrong token is 401 on every folder route; a traversal id never reaches a file', async (t) => {
    const server = await served(t);
    const routes: [string, string, unknown][] = [
      ['/folders', 'GET', undefined],
      ['/folders', 'POST', { name: 'A' }],
      ['/folders/f_aaaaaaaaaa', 'PATCH', { name: 'B' }],
      ['/folders/f_aaaaaaaaaa', 'DELETE', undefined],
      ['/folders/f_aaaaaaaaaa/undelete', 'POST', {}],
      ['/folders/f_aaaaaaaaaa/designs', 'POST', { add: [] }],
    ];
    for (const [pathname, method, body] of routes) {
      for (const token of [null, 'wrong']) {
        const answer = await server.request(pathname, { method, body, token });
        assert.equal(answer.status, 401, `${method} ${pathname}`);
      }
    }
    for (const hostile of ['..%2F..%2Fetc', '..', 'f_..........', 'F_AAAAAAAAAA']) {
      const answer = await server.request(`/folders/${hostile}`, { method: 'PATCH', body: { name: 'x' } });
      assert.ok(answer.status === 400 || answer.status === 404, `${hostile} ${answer.status}`);
    }
    await assert.rejects(readdir(path.join(server.root, '.chamber')), { code: 'ENOENT' });
  });

  test('the whole life over HTTP, and GET /designs carries projectFolders', async (t) => {
    const server = await served(t);
    const design = await server.store.create({ kind: 'page', title: 'Shop', projectDirectory: server.root });
    const events: string[] = [];
    server.ctx.hub.subscribe((event) => void events.push(event.kind));

    const bad = await server.request('/folders', { method: 'POST', body: { name: '' } });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as ApiErrorBody).message, 'Give the folder a name.');

    const created = (await (await server.request('/folders', { method: 'POST', body: { name: 'Launch' } })).json()) as FolderResponse;
    const dup = await server.request('/folders', { method: 'POST', body: { name: 'LAUNCH' } });
    assert.equal(dup.status, 409);
    const id = created.folder.id;
    const added = (await (await server.request(`/folders/${id}/designs`, { method: 'POST', body: { add: [design.slug, 'nope'] } })).json()) as FolderResponse;
    assert.deepEqual(added.folder.slugs, [design.slug]);
    const renamed = (await (await server.request(`/folders/${id}`, { method: 'PATCH', body: { name: 'Q4' } })).json()) as FolderResponse;
    assert.equal(renamed.folder.name, 'Q4');
    const deleted = (await (await server.request(`/folders/${id}`, { method: 'DELETE' })).json()) as DeleteFolderResponse;
    assert.deepEqual(deleted, { ok: true, designs: 1, onlyHere: 1 });
    assert.deepEqual(((await (await server.request('/folders')).json()) as FolderListResponse).folders, []);
    const back = await server.request(`/folders/${id}/undelete`, { method: 'POST', body: {} });
    assert.equal(back.status, 200);
    const list = (await (await server.request('/folders')).json()) as FolderListResponse;
    assert.deepEqual(list.folders.map((entry) => [entry.name, entry.slugs]), [['Q4', [design.slug]]]);
    assert.ok(events.filter((kind) => kind === 'folders').length >= 5);

    const designs = (await (await server.request('/designs')).json()) as DesignListResponse;
    assert.deepEqual(designs.projectFolders, [{ directory: server.root, exists: true }]);
  });
});
