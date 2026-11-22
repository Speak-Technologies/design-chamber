// Filing at creation (documentation/specs/phase-2-6-technical.md §5.3, AD-5) and "manual members
// never alter rules or pins" (§10.4): `POST /chip { filing }` files the new design best effort
// after it is made, a filing failure never fails the chip, a bad filing shape is refused before
// anything is made, and a design filed by hand under another project keeps its own project's
// system, rules, chip and design.json. Real store and routes over a tmp root.

import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { ChipResponse, DesignListResponse, FolderListResponse, FolderResponse, MembershipsResponse } from '../../src/shared/api.ts';
import type { SettingsFile } from '../../src/shared/types.ts';
import type { ServiceContext } from '../../src/service/context.ts';
import { FOLDER_GONE } from '../../src/service/folders.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../src/service/http.ts';
import { FILING_FAILED_MESSAGE, registerChatRoutes } from '../../src/service/routes/chat.ts';
import { registerDesignsRoutes } from '../../src/service/routes/designs.ts';
import { registerFoldersRoutes } from '../../src/service/routes/folders.ts';
import { registerMembershipsRoutes } from '../../src/service/routes/memberships.ts';
import { createDesignStore } from '../../src/service/store.ts';
import { ensureSystemStore } from '../../src/service/systems/store.ts';
import { createFakeContext } from '../helpers/fake-context.ts';
import { useTmpRoot } from '../helpers/tmp-root.ts';

const TOKEN = 'chip-filing-token-0123456789';

const serve = async (t: TestContext, settings: Partial<SettingsFile> = {}) => {
  const tmp = await useTmpRoot(t);
  const fake = createFakeContext({
    root: tmp.root,
    settings,
    overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } },
  });
  t.after(() => fake.dispose());
  const ctx: ServiceContext = Object.assign(fake, { store: createDesignStore({ settings: fake.settings, log: fake.log, hub: fake.hub }) });
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerDesignsRoutes(router, ctx);
  registerChatRoutes(router, ctx);
  registerFoldersRoutes(router, ctx);
  registerMembershipsRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async <T>(method: string, url: string, body?: unknown, token: string | null = TOKEN): Promise<{ status: number; json: T }> => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, json: (await answer.json()) as T };
  };
  return { tmp, ctx, call, logs: fake.logs };
};

/** A project folder outside the designs root (a stored string; discovery finds nothing there). */
const projectAt = (root: string, name: string): string => path.join(path.dirname(root), `${path.basename(root)}-${name}`);

const designFolders = async (root: string): Promise<string[]> => (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')).map((entry) => entry.name);

test('filing at creation: every target answers; the design is in its folder and project at once', async (t) => {
  const { tmp, call } = await serve(t);
  const shop = projectAt(tmp.root, 'shop');
  const folder = (await call<FolderResponse>('POST', '/folders', { name: 'Q4 launch' })).json.folder;
  const answer = await call<ChipResponse>('POST', '/chip', { kind: 'page', brief: 'Pricing page', filing: { folders: [folder.id], projects: [shop] } });
  assert.equal(answer.status, 200);
  const { slug, filing } = answer.json;
  assert.deepEqual(filing, {
    results: [
      { target: { kind: 'folder', id: folder.id }, ok: true },
      { target: { kind: 'project', directory: shop }, ok: true },
    ],
  });
  const list = (await call<FolderListResponse>('GET', '/folders')).json;
  assert.deepEqual(list.folders.map((entry) => [entry.name, entry.slugs]), [['Q4 launch', [slug]]]);
  assert.deepEqual(list.projects, [{ directory: shop, slugs: [slug] }]);

  // No filing asked: no `filing` in the answer.
  const plain = (await call<ChipResponse>('POST', '/chip', { kind: 'page', brief: 'Plain' })).json;
  assert.equal(Object.hasOwn(plain, 'filing'), false);
});

test('a partial filing failure never fails the chip; a gone folder says so', async (t) => {
  const { tmp, call } = await serve(t);
  const folder = (await call<FolderResponse>('POST', '/folders', { name: 'Kept' })).json.folder;
  const answer = await call<ChipResponse>('POST', '/chip', {
    kind: 'canvas',
    brief: 'Checkout',
    filing: { folders: ['f_zzzzzzzzzz', folder.id], projects: [tmp.root] },
  });
  assert.equal(answer.status, 200);
  assert.deepEqual(
    answer.json.filing?.results.map((result) => (result.ok ? 'ok' : [result.code, result.message])),
    [['gone', FOLDER_GONE], 'ok', ['invalid', "That project folder can't be used."]],
  );
  assert.ok((await designFolders(tmp.root)).includes(answer.json.slug));
});

test('a registry that cannot be written reports every target and still makes the design', async (t) => {
  const { tmp, call, logs } = await serve(t);
  // `.chamber` is a file: the registry can be neither read nor written.
  await writeFile(path.join(tmp.root, '.chamber'), 'not a folder');
  const answer = await call<ChipResponse>('POST', '/chip', { kind: 'page', brief: 'Pricing', filing: { folders: ['f_aaaaaaaaaa'], projects: [projectAt(tmp.root, 'shop')] } });
  assert.equal(answer.status, 200);
  assert.equal(answer.json.filing?.results.length, 2);
  for (const result of answer.json.filing?.results ?? []) {
    assert.deepEqual(result.ok ? 'ok' : [result.code, result.message], ['invalid', FILING_FAILED_MESSAGE]);
  }
  assert.ok((await designFolders(tmp.root)).includes(answer.json.slug));
  assert.ok(logs.some((line) => line.event === 'folders.creation-filing-failed'));
});

test('a bad filing shape is refused before anything is made', async (t) => {
  const { tmp, call } = await serve(t);
  for (const filing of ['f_aaaaaaaaaa', [], { folders: 'f_aaaaaaaaaa' }, { folders: [7] }, { folders: [''] }, { projects: Array.from({ length: 15 }, (_unused, i) => `/p/${i}`) }, { folders: Array.from({ length: 51 }, () => 'f_aaaaaaaaaa') }]) {
    const answer = await call<{ message: string }>('POST', '/chip', { kind: 'page', brief: 'x', filing });
    assert.equal(answer.status, 400, JSON.stringify(filing).slice(0, 60));
    assert.equal(answer.json.message, "Design Chamber couldn't read the folders to file this design in. Nothing was made.");
  }
  assert.deepEqual(await designFolders(tmp.root), []);
});

test('a filing request is bearer-gated like the chip itself', async (t) => {
  const { tmp, call } = await serve(t);
  for (const token of [null, 'wrong']) {
    const answer = await call('POST', '/chip', { kind: 'page', brief: 'x', filing: { folders: ['f_aaaaaaaaaa'] } }, token);
    assert.equal(answer.status, 401);
  }
  assert.deepEqual(await designFolders(tmp.root), []);
});

test('ids from the previous designs folder file nothing after a root change, and say so', async (t) => {
  const { tmp, ctx, call } = await serve(t);
  const folder = (await call<FolderResponse>('POST', '/folders', { name: 'Old root' })).json.folder;
  const rootB = projectAt(tmp.root, 'designs-b');
  await mkdir(rootB);
  t.after(() => rm(rootB, { recursive: true, force: true }));
  await ctx.settings.update({ root: rootB });
  const answer = await call<ChipResponse>('POST', '/chip', { kind: 'page', brief: 'Moved', filing: { folders: [folder.id] } });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.json.filing?.results, [{ target: { kind: 'folder', id: folder.id }, ok: false, code: 'gone', message: FOLDER_GONE }]);
});

test('§10.4: a design filed by hand under project B keeps project A\'s system, rules, chip and design.json', async (t) => {
  const { tmp, ctx, call } = await serve(t);
  const projectA = projectAt(tmp.root, 'project-a');
  const projectB = projectAt(tmp.root, 'project-b');
  // Systems are made first so the pins can name their ids.
  const systems = ensureSystemStore(ctx);
  const ready = async (name: string, colour: string): Promise<string> => {
    const { id } = await systems.create({ name });
    await tmp.write(`_systems/${id}/tokens.css`, `:root {\n  --brand-500: ${colour};\n}\n`);
    await tmp.write(`_systems/${id}/OVERVIEW.md`, `${name}.\n`);
    await systems.patch(id, { status: 'ready' });
    return id;
  };
  const x = await ready('Xenon', '#112233');
  const y = await ready('Yarrow', '#445566');
  const pins = [
    { directory: projectA, choice: 'system' as const, id: x },
    { directory: projectB, choice: 'system' as const, id: y },
  ];
  await ctx.settings.update({ systemPins: pins });
  const pinsBefore = JSON.stringify(ctx.settings.read().systemPins);

  const filed = await call<ChipResponse>('POST', '/chip', { kind: 'page', brief: 'Pricing page', projectDirectory: projectA, filing: { projects: [projectB] } });
  const unfiled = await call<ChipResponse>('POST', '/chip', { kind: 'page', brief: 'Pricing page', projectDirectory: projectA });
  assert.equal(filed.status, 200);
  assert.equal(unfiled.status, 200);
  const slug = filed.json.slug;
  assert.deepEqual(filed.json.filing?.results, [{ target: { kind: 'project', directory: projectB }, ok: true }]);

  // The link and the rules come from project A's pin, never B's.
  const copy = JSON.parse(await tmp.read(`${slug}/system/COPY.json`)) as { id: string };
  assert.equal(copy.id, x);
  const rules = await tmp.read(`${slug}/.chamber/RULES.md`);
  assert.ok(rules.includes('Xenon'), 'RULES.md names project A\'s system');
  assert.equal(rules.includes('Yarrow'), false);
  // Same chip and rules as the unfiled twin, slugs aside.
  const neutral = (text: string, own: string): string => text.split(own).join('<slug>');
  assert.equal(neutral(filed.json.chip.text, slug), neutral(unfiled.json.chip.text, unfiled.json.slug));
  assert.equal(neutral(rules, slug), neutral(await tmp.read(`${unfiled.json.slug}/.chamber/RULES.md`), unfiled.json.slug));

  // Filing again by hand changes no design byte, no project and no pin.
  const designBefore = await tmp.read(`${slug}/design.json`);
  const moreFiling = await call<MembershipsResponse>('POST', '/memberships', {
    changes: [
      { target: { kind: 'project', directory: projectB }, add: [slug, unfiled.json.slug] },
      { target: { kind: 'project', directory: projectA }, add: [slug] },
    ],
  });
  assert.equal(moreFiling.status, 200);
  assert.equal(await tmp.read(`${slug}/design.json`), designBefore);
  assert.equal(JSON.stringify(ctx.settings.read().systemPins), pinsBefore);
  const designs = (await call<DesignListResponse>('GET', '/designs')).json.designs;
  assert.equal(designs.find((design) => design.slug === slug)?.projectDirectory, projectA);
  // A is the derived project of both designs: never written as a manual member there.
  assert.deepEqual(moreFiling.json.list.projects, [{ directory: projectB, slugs: [slug, unfiled.json.slug] }]);
  const registry = JSON.parse(await readFile(path.join(tmp.root, '.chamber', 'folders.json'), 'utf8')) as { projects: { directory: string }[] };
  assert.deepEqual(registry.projects.map((project) => project.directory), [projectB]);
});
