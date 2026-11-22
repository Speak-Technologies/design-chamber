// Manual folders (Phase 2.5 G1; documentation/specs/phase-2-5-technical.md §2.8, §3.3, §5.8): the
// registry parse and its damaged recovery, set semantics, slug+created keying, prune on removed,
// soft delete and undelete, a root change, multi-folder membership, and the routes behind the
// bearer token. Real settings, store and hub over a tmp root (the WP1 core harness).

import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { ApiErrorBody, DeleteFolderResponse, DesignListResponse, FolderListResponse, FolderResponse, MembershipsResponse } from '../../../src/shared/api.ts';
import { FOLDER_UNDO_MS, FOLDERS_MAX } from '../../../src/shared/limits.ts';
import type { DesignSummary } from '../../../src/shared/types.ts';
import {
  applyChanges,
  applyMembership,
  cleanRegistry,
  createFoldersService,
  createProjectFolderStats,
  FOLDER_DESIGNS_FULL,
  FOLDER_GONE,
  FOLDER_NAME_EMPTY,
  FOLDERS_FULL,
  FoldersDamagedError,
  listView,
  mintFolderId,
  normalizeFolderName,
  normalizeProjectDirectory,
  onlyHereCount,
  parseFolderChange,
  parseFoldersRegistry,
  parseMembershipsBody,
  PROJECT_UNUSABLE,
  PROJECTS_FULL,
  type FoldersRegistry,
  type FoldersService,
  type LiveDesigns,
  type RegistryRead,
} from '../../../src/service/folders.ts';
import { ApiError } from '../../../src/service/http.ts';
import { registerFoldersRoutes } from '../../../src/service/routes/folders.ts';
import { registerMembershipsRoutes } from '../../../src/service/routes/memberships.ts';
import { createCore, serveCore, type Core } from './harness.ts';

const T0 = '2026-11-01T10:00:00.000Z';
/** A designs root for the pure parse (never touched). */
const ROOT = path.resolve('/srv/dc-test/Designs');
const registryOf = (folders: FoldersRegistry['folders'], rev = 1, projects: FoldersRegistry['projects'] = []): FoldersRegistry => ({ v: 1, rev, folders, projects });
const folder = (id: string, name: string, designs: { slug: string; created: string }[] = [], deleted: string | null = null) => ({ id, name, created: T0, deleted, designs });
/** slug → created (and the design's own project, null by default). */
const liveOf = (entries: [string, string, (string | null)?][]): LiveDesigns => new Map(entries.map(([slug, created, projectDirectory = null]) => [slug, { created, projectDirectory }]));

describe('folders: pure parts', () => {
  test('a valid registry parses; anything wrong reads as null (damaged)', () => {
    const good = registryOf([folder('f_aaaaaaaaaa', 'Launch', [{ slug: 'checkout', created: T0 }])], 3);
    assert.deepEqual(parseFoldersRegistry(JSON.stringify(good), ROOT), good);
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
      assert.equal(parseFoldersRegistry(bad, ROOT), null, bad.slice(0, 80));
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
    const live = liveOf([['checkout', T0], ['hero', '2026-11-02T00:00:00.000Z']]);
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
    const live = liveOf([['checkout', T0]]);
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

    assert.deepEqual(await folders.remove(target.id), { designs: 1, onlyHere: 1 });
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

  test('deleting a deleted folder or undeleting a live one writes nothing: no rev bump, no event', async (t) => {
    const { core, folders, file } = await rig(t);
    const design = await core.store.create({ kind: 'page', title: 'Page' });
    const target = await folders.create('Launch');
    await folders.change(target.id, { add: [design.slug], remove: [] });
    const rev = (await onDisk(file)).rev;
    const events: string[] = [];
    core.ctx.hub.subscribe((event) => void events.push(event.kind));

    assert.deepEqual((await folders.undelete(target.id)).slugs, [design.slug]);
    assert.equal((await onDisk(file)).rev, rev);
    await folders.remove(target.id);
    assert.equal((await onDisk(file)).rev, rev + 1);
    const afterDelete = events.length;
    assert.deepEqual(await folders.remove(target.id), { designs: 1, onlyHere: 1 });
    assert.equal((await onDisk(file)).rev, rev + 1);
    assert.equal(events.length, afterDelete);
    assert.equal(events.filter((kind) => kind === 'folders').length, 1);
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

// ---- Phase 2.6: manual project members, batches, onlyHere, agent requests (P26 §2.1, §5.1) ----

const SHOP = path.resolve('/srv/dc-test/work/shop');
const BLOG = path.resolve('/srv/dc-test/work/blog');
const member = (slug: string, created = T0) => ({ slug, created });

describe('folders: manual project members (pure)', () => {
  test('a 0.4.0 file (no projects) parses unchanged and answers projects []', () => {
    const old = { v: 1, rev: 7, folders: [folder('f_aaaaaaaaaa', 'Launch', [member('checkout')])] };
    assert.deepEqual(parseFoldersRegistry(JSON.stringify(old), ROOT), { ...old, projects: [] });
    const read: RegistryRead = { kind: 'ok', registry: registryOf(old.folders, old.rev) };
    assert.deepEqual(listView(read, liveOf([['checkout', T0]])), { folders: [{ id: 'f_aaaaaaaaaa', name: 'Launch', created: T0, slugs: ['checkout'] }], projects: [] });
  });

  test('projects parse strictly: a bad, duplicate or root-side entry makes the file damaged', () => {
    const good = registryOf([], 2, [
      { directory: SHOP, designs: [member('pricing')] },
      { directory: 'C:\\Work\\Blog', designs: [] },
      { directory: '\\\\server\\share\\app', designs: [] },
    ]);
    assert.deepEqual(parseFoldersRegistry(JSON.stringify(good), ROOT), good);
    const withProjects = (projects: unknown): string => JSON.stringify({ v: 1, rev: 1, folders: [], projects });
    const bad: [string, string][] = [
      ['not a list', withProjects({})],
      ['null', withProjects(null)],
      ['duplicate, either slash and case with a drive', withProjects([{ directory: 'C:\\Work\\Shop', designs: [] }, { directory: 'c:/work/shop', designs: [] }])],
      ['duplicate, exact', withProjects([{ directory: SHOP, designs: [] }, { directory: SHOP, designs: [] }])],
      ['the designs root', withProjects([{ directory: ROOT, designs: [] }])],
      ['inside the designs root', withProjects([{ directory: path.join(ROOT, 'inner'), designs: [] }])],
      ['relative', withProjects([{ directory: 'work/shop', designs: [] }])],
      ['NUL', withProjects([{ directory: `${SHOP}\u0000x`, designs: [] }])],
      ['not the stored spelling (trailing separator)', withProjects([{ directory: `${SHOP}${path.sep}`, designs: [] }])],
      ['too long', withProjects([{ directory: `/${'a'.repeat(4096)}`, designs: [] }])],
      ['not text', withProjects([{ directory: 42, designs: [] }])],
      ['a bad member', withProjects([{ directory: SHOP, designs: [{ slug: '../x', created: T0 }] }])],
      ['over 100 entries', withProjects(Array.from({ length: 101 }, (_unused, i) => ({ directory: path.join(SHOP, `p${i}`), designs: [] })))],
    ];
    for (const [why, text] of bad) assert.equal(parseFoldersRegistry(text, ROOT), null, why);
  });

  test('a project directory is stored trimmed, refused at or inside the root, never stat-ed', () => {
    assert.equal(normalizeProjectDirectory(`${SHOP}${path.sep}${path.sep}`, ROOT), SHOP);
    assert.equal(normalizeProjectDirectory('/', ROOT), '/');
    assert.equal(normalizeProjectDirectory('C:\\', ROOT), 'C:\\');
    assert.equal(normalizeProjectDirectory('\\\\server\\share\\app\\', ROOT), '\\\\server\\share\\app');
    for (const bad of [ROOT, path.join(ROOT, 'a', 'b'), 'relative/dir', '', 42, null, `/${'a'.repeat(4096)}`, `${SHOP}\u0007`]) {
      assert.equal(normalizeProjectDirectory(bad, ROOT), null, String(bad).slice(0, 60));
    }
  });

  test('clean drops dead members, members now derived there, and entries left empty', () => {
    const live = liveOf([['a', T0], ['b', T0, `${SHOP}/`]]);
    const { registry, changed } = cleanRegistry(
      registryOf([], 1, [
        { directory: SHOP, designs: [member('a'), member('a'), member('b'), member('gone'), member('a', '2020-01-01T00:00:00.000Z')] },
        { directory: BLOG, designs: [member('gone')] },
      ]),
      live,
      Date.parse(T0),
    );
    assert.equal(changed, true);
    assert.deepEqual(registry.projects, [{ directory: SHOP, designs: [member('a')] }]);
    assert.equal(cleanRegistry(registry, live, Date.parse(T0)).changed, false);
  });

  test('project changes: derived skip, create on add, drop when emptied, caps', () => {
    const live = liveOf([['a', T0], ['b', T0, SHOP]]);
    const empty = registryOf([]);
    const options = { atomic: false, root: ROOT };

    // Membership never shadows the derived project: the add is a quiet no-op, no entry is made.
    const derived = applyChanges(empty, [{ target: { kind: 'project', directory: `${SHOP}${path.sep}` }, add: ['b'], remove: [] }], live, options);
    assert.deepEqual(derived.results, [{ target: { kind: 'project', directory: `${SHOP}${path.sep}` }, ok: true }]);
    assert.deepEqual(derived.registry.projects, []);

    const added = applyChanges(empty, [{ target: { kind: 'project', directory: `${SHOP}${path.sep}` }, add: ['a', 'ghost'], remove: [] }], live, options);
    assert.deepEqual(added.registry.projects, [{ directory: SHOP, designs: [member('a')] }]);
    const removed = applyChanges(added.registry, [{ target: { kind: 'project', directory: SHOP }, add: [], remove: ['a'] }], live, options);
    assert.deepEqual(removed.registry.projects, []);

    const unusable = applyChanges(empty, [{ target: { kind: 'project', directory: path.join(ROOT, 'x') }, add: ['a'], remove: [] }], live, options);
    assert.deepEqual(unusable.results[0], { target: { kind: 'project', directory: path.join(ROOT, 'x') }, ok: false, code: 'invalid', message: PROJECT_UNUSABLE });

    const hundred = registryOf([], 1, Array.from({ length: 100 }, (_unused, i) => ({ directory: path.join(BLOG, `p${i}`), designs: [member('a')] })));
    const over = applyChanges(hundred, [{ target: { kind: 'project', directory: SHOP }, add: ['a'], remove: [] }], live, options);
    assert.deepEqual(over.results[0], { target: { kind: 'project', directory: SHOP }, ok: false, code: 'full', message: PROJECTS_FULL });
    assert.equal(over.registry, hundred);
    // An existing entry still takes members at the cap.
    assert.equal(applyChanges(hundred, [{ target: { kind: 'project', directory: path.join(BLOG, 'p3') }, add: ['b'], remove: [] }], live, options).results[0]?.ok, true);
  });

  test('folder changes: gone, a bad id and a full folder answer their own result', () => {
    const full = folder('f_aaaaaaaaaa', 'Full', Array.from({ length: 2000 }, (_unused, i) => member(`d${i}`)));
    const live = liveOf([['new', T0]]);
    const { results } = applyChanges(
      registryOf([full]),
      [
        { target: { kind: 'folder', id: 'f_zzzzzzzzzz' }, add: ['new'], remove: [] },
        { target: { kind: 'folder', id: '../x' }, add: ['new'], remove: [] },
        { target: { kind: 'folder', id: 'f_aaaaaaaaaa' }, add: ['new'], remove: [] },
      ],
      live,
      { atomic: false, root: ROOT },
    );
    assert.deepEqual(
      results.map((result) => (result.ok ? 'ok' : [result.code, result.message])),
      [['gone', FOLDER_GONE], ['invalid', FOLDER_GONE], ['full', FOLDER_DESIGNS_FULL]],
    );
  });

  test('best effort keeps the changes that worked; atomic throws on the first failure and returns nothing', () => {
    const live = liveOf([['a', T0]]);
    const start = registryOf([folder('f_aaaaaaaaaa', 'A')]);
    const changes = [
      { target: { kind: 'folder' as const, id: 'f_aaaaaaaaaa' }, add: ['a'], remove: [] },
      { target: { kind: 'folder' as const, id: 'f_zzzzzzzzzz' }, add: ['a'], remove: [] },
    ];
    const best = applyChanges(start, changes, live, { atomic: false, root: ROOT });
    assert.deepEqual(best.results.map((result) => result.ok), [true, false]);
    assert.deepEqual(best.registry.folders[0]?.designs, [member('a')]);
    assert.throws(() => applyChanges(start, changes, live, { atomic: true, root: ROOT }), (error: unknown) => error instanceof ApiError && error.code === 'not-found' && error.message === FOLDER_GONE);
    assert.throws(
      () => applyChanges(start, [{ target: { kind: 'project', directory: 'nope' }, add: ['a'], remove: [] }], live, { atomic: true, root: ROOT }),
      (error: unknown) => error instanceof ApiError && error.code === 'bad-request' && error.message === PROJECT_UNUSABLE,
    );
    const hundred = registryOf([], 1, Array.from({ length: 100 }, (_unused, i) => ({ directory: path.join(BLOG, `p${i}`), designs: [member('a')] })));
    assert.throws(
      () => applyChanges(hundred, [{ target: { kind: 'project', directory: SHOP }, add: ['a'], remove: [] }], live, { atomic: true, root: ROOT }),
      (error: unknown) => error instanceof ApiError && error.code === 'conflict' && error.message === PROJECTS_FULL,
    );
    assert.deepEqual(start.folders[0]?.designs, []);
  });

  test('onlyHere counts live members in no other LIVE folder', () => {
    const live = liveOf([['a', T0], ['b', T0], ['c', T0]]);
    const a = folder('f_aaaaaaaaaa', 'A', [member('a'), member('b'), member('c')]);
    const registry = registryOf([
      a,
      folder('f_bbbbbbbbbb', 'B', [member('a'), member('c', '2020-01-01T00:00:00.000Z')]),
      folder('f_cccccccccc', 'Deleted', [member('b')], T0),
    ]);
    // a is also in B; b's other folder is deleted; c's entry in B is a dead one.
    assert.equal(onlyHereCount(registry, a, live), 2);
  });

  test('the list answers live, non-derived manual members only', () => {
    const live = liveOf([['a', T0], ['b', T0, SHOP]]);
    const read = { kind: 'ok', registry: registryOf([], 1, [{ directory: SHOP, designs: [member('a'), member('b'), member('gone')] }, { directory: BLOG, designs: [member('gone')] }]) } as const;
    assert.deepEqual(listView(read, live).projects, [{ directory: SHOP, slugs: ['a'] }]);
  });

  test('batch bodies: 1..64 changes, ≤ 400 slugs, shapes checked, slugs filtered', () => {
    const target = { kind: 'folder', id: 'f_aaaaaaaaaa' };
    assert.deepEqual(parseMembershipsBody({ changes: [{ target, add: ['a', '../x'] }, { target: { kind: 'project', directory: SHOP }, remove: ['b'] }] }), {
      changes: [
        { target, add: ['a'], remove: [] },
        { target: { kind: 'project', directory: SHOP }, add: [], remove: ['b'] },
      ],
      atomic: false,
    });
    assert.equal(parseMembershipsBody({ changes: [{ target }], atomic: true }).atomic, true);
    const many = (count: number, slugs: number) => ({ changes: Array.from({ length: count }, () => ({ target, add: Array.from({ length: slugs }, (_unused, i) => `d${i}`) })) });
    assert.doesNotThrow(() => parseMembershipsBody(many(2, 200)));
    for (const bad of [
      null,
      [],
      {},
      { changes: [] },
      many(65, 1),
      many(3, 134),
      { changes: [{ target, add: ['a'], remove: ['a'] }] },
      { changes: [{ target: { kind: 'tag', id: 'x' } }] },
      { changes: [{ target: { kind: 'folder', id: 'f'.repeat(65) } }] },
      { changes: [{ target: { kind: 'project', directory: 7 } }] },
      { changes: [{ target }], atomic: 'yes' },
      { changes: ['f_aaaaaaaaaa'] },
    ]) {
      assert.throws(() => parseMembershipsBody(bad), (error: unknown) => error instanceof ApiError && error.code === 'bad-request', JSON.stringify(bad)?.slice(0, 80));
    }
  });
});

describe('folders: batches, onlyHere and agent requests over a real store', () => {
  const eventsOf = (core: Core): string[] => {
    const events: string[] = [];
    core.ctx.hub.subscribe((event) => void events.push(event.kind));
    return events;
  };

  test('a 0.4.0 registry lists unchanged without a write; the first write adds projects and rev + 1', async (t) => {
    const { core, folders, file } = await rig(t);
    const design = await core.store.create({ kind: 'page', title: 'Checkout' });
    const old = `${JSON.stringify({ v: 1, rev: 9, folders: [folder('f_aaaaaaaaaa', 'Launch', [{ slug: design.slug, created: design.design.created }])] }, null, 2)}\n`;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, old);

    const list = await folders.list();
    assert.deepEqual(list, { folders: [{ id: 'f_aaaaaaaaaa', name: 'Launch', created: T0, slugs: [design.slug] }], projects: [] });
    assert.equal(await readFile(file, 'utf8'), old);

    const shop = core.tmp.at('work/shop');
    const answer = await folders.changeMany([{ target: { kind: 'project', directory: shop }, add: [design.slug], remove: [] }], { atomic: false });
    assert.deepEqual(answer.results, [{ target: { kind: 'project', directory: shop }, ok: true }]);
    assert.deepEqual(answer.list.projects, [{ directory: shop, slugs: [design.slug] }]);
    const after = await onDisk(file);
    assert.equal(after.rev, 10);
    assert.deepEqual(Object.keys(after), ['v', 'rev', 'folders', 'projects']);
    assert.deepEqual(after.folders.map((entry) => entry.name), ['Launch']);
    assert.deepEqual(after.projects, [{ directory: shop, designs: [{ slug: design.slug, created: design.design.created }] }]);
    // Nothing moved on disk: only the registry was written.
    assert.deepEqual((await readdir(core.root)).sort(), ['.chamber', design.slug].sort());
  });

  test('an atomic batch with a failing change writes nothing and emits nothing', async (t) => {
    const { core, folders, file } = await rig(t);
    const design = await core.store.create({ kind: 'page', title: 'Pricing' });
    const a = await folders.create('A');
    await folders.change(a.id, { add: [design.slug], remove: [] });
    const before = await readFile(file, 'utf8');
    const events = eventsOf(core);
    await assert.rejects(
      folders.changeMany(
        [
          { target: { kind: 'folder', id: a.id }, add: [], remove: [design.slug] },
          { target: { kind: 'folder', id: 'f_zzzzzzzzzz' }, add: [design.slug], remove: [] },
        ],
        { atomic: true },
      ),
      { code: 'not-found', message: FOLDER_GONE },
    );
    assert.equal(await readFile(file, 'utf8'), before);
    assert.deepEqual(events, []);
  });

  test('a best-effort batch where every change failed writes nothing; a partial one writes once', async (t) => {
    const { core, folders, file } = await rig(t);
    const design = await core.store.create({ kind: 'page', title: 'Pricing' });
    const a = await folders.create('A');
    const before = await readFile(file, 'utf8');
    const events = eventsOf(core);
    const failed = await folders.changeMany(
      [
        { target: { kind: 'folder', id: 'f_zzzzzzzzzz' }, add: [design.slug], remove: [] },
        { target: { kind: 'project', directory: core.root }, add: [design.slug], remove: [] },
      ],
      { atomic: false },
    );
    assert.deepEqual(failed.results.map((result) => (result.ok ? 'ok' : result.code)), ['gone', 'invalid']);
    assert.equal(await readFile(file, 'utf8'), before);
    assert.deepEqual(events, []);

    const partial = await folders.changeMany(
      [
        { target: { kind: 'folder', id: 'f_zzzzzzzzzz' }, add: [design.slug], remove: [] },
        { target: { kind: 'folder', id: a.id }, add: [design.slug], remove: [] },
      ],
      { atomic: false },
    );
    assert.deepEqual(partial.results.map((result) => result.ok), [false, true]);
    assert.deepEqual(partial.list.folders[0]?.slugs, [design.slug]);
    assert.equal((await onDisk(file)).rev, JSON.parse(before).rev + 1);
    assert.deepEqual(events, ['folders']);
  });

  test('Move is one atomic write: out of the folder viewed, into the target; Undo is the inverse', async (t) => {
    const { core, folders, file } = await rig(t);
    const design = await core.store.create({ kind: 'page', title: 'Pricing' });
    const from = await folders.create('From');
    const to = await folders.create('To');
    const other = await folders.create('Other');
    await folders.change(from.id, { add: [design.slug], remove: [] });
    await folders.change(other.id, { add: [design.slug], remove: [] });
    const rev = (await onDisk(file)).rev;
    const move = [
      { target: { kind: 'folder' as const, id: from.id }, add: [], remove: [design.slug] },
      { target: { kind: 'folder' as const, id: to.id }, add: [design.slug], remove: [] },
    ];
    const moved = await folders.changeMany(move, { atomic: true });
    assert.deepEqual(moved.list.folders.map((entry) => [entry.name, entry.slugs]), [['From', []], ['To', [design.slug]], ['Other', [design.slug]]]);
    assert.equal((await onDisk(file)).rev, rev + 1);
    const undo = await folders.changeMany(
      [
        { target: { kind: 'folder', id: to.id }, add: [], remove: [design.slug] },
        { target: { kind: 'folder', id: from.id }, add: [design.slug], remove: [] },
      ],
      { atomic: true },
    );
    assert.deepEqual(undo.list.folders.map((entry) => [entry.name, entry.slugs]), [['From', [design.slug]], ['To', []], ['Other', [design.slug]]]);
  });

  test('delete answers designs and onlyHere from the same write', async (t) => {
    const { core, folders } = await rig(t);
    const shared = await core.store.create({ kind: 'page', title: 'Shared' });
    const alone = await core.store.create({ kind: 'page', title: 'Alone' });
    const a = await folders.create('A');
    const b = await folders.create('B');
    await folders.change(a.id, { add: [shared.slug, alone.slug], remove: [] });
    await folders.change(b.id, { add: [shared.slug], remove: [] });
    // A membership change queued just before the delete is counted (the counts are the write's).
    const [, removed] = await Promise.all([folders.change(b.id, { add: [alone.slug], remove: [] }), folders.remove(a.id)]);
    assert.deepEqual(removed, { designs: 2, onlyHere: 0 });
    const empty = await folders.create('Empty');
    assert.deepEqual(await folders.remove(empty.id), { designs: 0, onlyHere: 0 });
    // Deleting B now: both designs lose their last live folder (A is deleted).
    assert.deepEqual(await folders.remove(b.id), { designs: 2, onlyHere: 2 });
  });

  test('changeByName tags existing folders by name ignoring case, never creates, never touches projects', async (t) => {
    const { core, folders, file } = await rig(t);
    const design = await core.store.create({ kind: 'page', title: 'Pricing' });
    const q4 = await folders.create('Q4 launch');
    const shop = core.tmp.at('work/shop');
    await folders.changeMany([{ target: { kind: 'project', directory: shop }, add: [design.slug], remove: [] }], { atomic: false });

    assert.deepEqual(await folders.changeByName(design.slug, { add: ['q4 LAUNCH', 'Ideas'], remove: ['Ghost'] }), { unknown: ['Ideas'] });
    const list = await folders.list();
    assert.deepEqual(list.folders.map((entry) => [entry.name, entry.slugs]), [['Q4 launch', [design.slug]]]);
    assert.deepEqual(list.projects, [{ directory: shop, slugs: [design.slug] }]);

    // Only unknown names: nothing to change, nothing written.
    const before = await readFile(file, 'utf8');
    assert.deepEqual(await folders.changeByName(design.slug, { add: ['Nope'], remove: [] }), { unknown: ['Nope'] });
    assert.equal(await readFile(file, 'utf8'), before);

    assert.deepEqual(await folders.changeByName(design.slug, { add: [], remove: ['Q4 Launch'] }), { unknown: [] });
    assert.deepEqual((await folders.list()).folders.find((entry) => entry.id === q4.id)?.slugs, []);
    assert.deepEqual((await folders.list()).projects, [{ directory: shop, slugs: [design.slug] }]);
  });

  test('changeByName with no registry creates no file; over a damaged one it refuses and leaves it as it is', async (t) => {
    const { core, folders, file } = await rig(t);
    const design = await core.store.create({ kind: 'page', title: 'Pricing' });
    assert.deepEqual(await folders.changeByName(design.slug, { add: ['Q4'], remove: [] }), { unknown: ['Q4'] });
    await assert.rejects(readFile(file), { code: 'ENOENT' });

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{ damaged');
    await assert.rejects(folders.changeByName(design.slug, { add: ['Q4'], remove: [] }), (error: unknown) => error instanceof FoldersDamagedError);
    assert.equal(await readFile(file, 'utf8'), '{ damaged');
    assert.deepEqual((await readdir(path.dirname(file))).sort(), ['folders.json']);
  });
});

describe('memberships: route', () => {
  const served = async (t: TestContext) => {
    const core = await createCore(t);
    t.after(() => core.stop());
    const server = await serveCore(t, core);
    registerFoldersRoutes(server.router, core.ctx);
    registerMembershipsRoutes(server.router, core.ctx);
    return server;
  };
  const post = (server: Awaited<ReturnType<typeof served>>, body: unknown, token?: string | null) =>
    server.request('/memberships', { method: 'POST', body, ...(token === undefined ? {} : { token }) });

  test('a missing or wrong token is 401 and nothing is written', async (t) => {
    const server = await served(t);
    const design = await server.store.create({ kind: 'page', title: 'Pricing' });
    for (const token of [null, 'wrong']) {
      const answer = await post(server, { changes: [{ target: { kind: 'project', directory: server.tmp.at('work') }, add: [design.slug] }] }, token);
      assert.equal(answer.status, 401);
    }
    await assert.rejects(readdir(path.join(server.root, '.chamber')), { code: 'ENOENT' });
  });

  test('shapes and caps are 400 with a sentence; atomic failures are 404, 409 and 400 with nothing written', async (t) => {
    const server = await served(t);
    const design = await server.store.create({ kind: 'page', title: 'Pricing' });
    const shapes = await post(server, { changes: [] });
    assert.equal(shapes.status, 400);
    assert.equal(((await shapes.json()) as ApiErrorBody).message, 'Send between 1 and 64 folder changes at once.');
    assert.equal((await post(server, { changes: [{ target: { kind: 'folder', id: 'f_aaaaaaaaaa' }, add: ['a'], remove: ['a'] }] })).status, 400);

    const file = path.join(server.root, '.chamber', 'folders.json');
    await mkdir(path.dirname(file), { recursive: true });
    const projects = Array.from({ length: 100 }, (_unused, i) => ({ directory: server.tmp.at(`work/p${i}`), designs: [{ slug: design.slug, created: design.design.created }] }));
    const seeded = `${JSON.stringify({ v: 1, rev: 3, folders: [], projects }, null, 2)}\n`;
    await writeFile(file, seeded);

    const gone = await post(server, { changes: [{ target: { kind: 'folder', id: 'f_zzzzzzzzzz' }, add: [design.slug] }], atomic: true });
    assert.equal(gone.status, 404);
    assert.equal(((await gone.json()) as ApiErrorBody).message, FOLDER_GONE);
    const full = await post(server, { changes: [{ target: { kind: 'project', directory: server.tmp.at('work/new') }, add: [design.slug] }], atomic: true });
    assert.equal(full.status, 409);
    assert.equal(((await full.json()) as ApiErrorBody).message, PROJECTS_FULL);
    const outside = await post(server, { changes: [{ target: { kind: 'project', directory: '../../etc' }, add: [design.slug] }], atomic: true });
    assert.equal(outside.status, 400);
    assert.equal(((await outside.json()) as ApiErrorBody).message, PROJECT_UNUSABLE);
    assert.equal(await readFile(file, 'utf8'), seeded);
  });

  test('traversal targets answer invalid and reach no file; GET /folders answers the manual members', async (t) => {
    const server = await served(t);
    const design = await server.store.create({ kind: 'page', title: 'Pricing' });
    const shop = server.tmp.at('work/shop');
    const answer = await post(server, {
      changes: [
        { target: { kind: 'folder', id: '../../outside' }, add: [design.slug] },
        { target: { kind: 'project', directory: '..\\..\\Windows' }, add: [design.slug] },
        { target: { kind: 'project', directory: path.join(server.root, design.slug) }, add: [design.slug] },
        { target: { kind: 'project', directory: shop }, add: [design.slug, '../x'] },
      ],
    });
    assert.equal(answer.status, 200);
    const body = (await answer.json()) as MembershipsResponse;
    assert.deepEqual(body.results.map((result) => (result.ok ? 'ok' : result.code)), ['invalid', 'invalid', 'invalid', 'ok']);
    assert.deepEqual(body.list.projects, [{ directory: shop, slugs: [design.slug] }]);
    assert.deepEqual(((await (await server.request('/folders')).json()) as FolderListResponse).projects, [{ directory: shop, slugs: [design.slug] }]);
    // Only the registry was written; the project folder is a stored string, never made.
    assert.deepEqual(await readdir(path.join(server.root, '.chamber')), ['folders.json']);
    await assert.rejects(readdir(shop), { code: 'ENOENT' });
  });
});
