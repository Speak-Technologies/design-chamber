// QA regression tests for Phase 2.6 F1 (documentation/specs/phase-2-6-technical.md §5.1, §5.2,
// §5.4, §13): gaps the mutation sweep found. Each test fails when its guard is removed:
// - the 1 MiB write cap ("Folders are full."): a write past it is refused and nothing changes,
//   so the next read never sees a file that would read as damaged (and be set aside);
// - DELETE /folders/:id answers onlyHere as its own number over HTTP, not the designs count;
// - an agent request naming a soft-deleted folder reports it as unknown (no silent drop);
// - the composed service starts the folderRequest reconciler (compose.ts wiring).

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import type { DeleteFolderResponse } from '../../src/shared/api.ts';
import { FOLDER_DESIGNS_MAX } from '../../src/shared/limits.ts';
import type { ChangeEvent } from '../../src/shared/types.ts';
import { composeService } from '../../src/service/compose.ts';
import type { DesignStore, Logger } from '../../src/service/context.ts';
import { createFoldersService, ensureFoldersService, FOLDERS_FILE_FULL, FOLDERS_FILE_MAX_BYTES } from '../../src/service/folders.ts';
import { registerFoldersRoutes } from '../../src/service/routes/folders.ts';
import { useTmpRoot } from '../helpers/tmp-root.ts';
import { createCore, REPO_ROOT, serveCore } from './core/harness.ts';

const CREATED = '2026-11-01T10:00:00.000Z';

test('a write that would pass the 1 MiB cap is refused with "Folders are full." and nothing changes', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  // A store answering many live designs (the folders service only lists them).
  const slugs = Array.from({ length: 6 * FOLDER_DESIGNS_MAX }, (_unused, i) => `d${String(i).padStart(5, '0')}`);
  const store = { list: async () => slugs.map((slug) => ({ slug, created: CREATED, projectDirectory: null })) } as unknown as DesignStore;
  const folders = createFoldersService({ settings: core.ctx.settings, hub: core.ctx.hub, store, log: core.ctx.log });
  t.after(() => folders.dispose());

  const id = (n: number): string => `f_${String(n).repeat(10)}`;
  const full = (n: number) => ({ id: id(n), name: `F${n}`, created: CREATED, deleted: null, designs: slugs.slice(n * FOLDER_DESIGNS_MAX, (n + 1) * FOLDER_DESIGNS_MAX).map((slug) => ({ slug, created: CREATED })) });
  const spare = slugs.slice(5 * FOLDER_DESIGNS_MAX);
  const seedWith = (count: number): string => {
    const empty = { id: id(9), name: 'Spare', created: CREATED, deleted: null, designs: spare.slice(0, count).map((slug) => ({ slug, created: CREATED })) };
    return `${JSON.stringify({ v: 1, rev: 4, folders: [0, 1, 2, 3, 4].map(full).concat(empty), projects: [] }, null, 2)}\n`;
  };
  // Pad the spare folder until 400 more members would pass the cap, while the seed stays under it.
  let count = 0;
  while (Buffer.byteLength(seedWith(count + 400), 'utf8') <= FOLDERS_FILE_MAX_BYTES) count += 50;
  const text = seedWith(count);
  const empty = { id: id(9) };
  const size = Buffer.byteLength(text, 'utf8');
  assert.ok(size < FOLDERS_FILE_MAX_BYTES, `seed is ${size} bytes`);
  const file = path.join(core.root, '.chamber', 'folders.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);

  const events: string[] = [];
  core.ctx.hub.subscribe((event: ChangeEvent) => void events.push(event.kind));
  const more = spare.slice(count, count + 400);
  assert.equal(more.length, 400);
  await assert.rejects(folders.changeMany([{ target: { kind: 'folder', id: empty.id }, add: more.slice(0, 200), remove: [] }, { target: { kind: 'folder', id: empty.id }, add: more.slice(200), remove: [] }], { atomic: false }), {
    code: 'conflict',
    message: FOLDERS_FILE_FULL,
  });
  assert.equal(await readFile(file, 'utf8'), text);
  assert.deepEqual(events, []);
  // Still readable, not damaged.
  assert.equal((await folders.list()).damaged, undefined);
});

test('DELETE /folders/:id answers onlyHere apart from designs over HTTP', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const server = await serveCore(t, core);
  registerFoldersRoutes(server.router, core.ctx);
  const folders = ensureFoldersService(core.ctx);
  const shared = await core.store.create({ kind: 'page', title: 'Shared' });
  const alone = await core.store.create({ kind: 'page', title: 'Alone' });
  const a = await folders.create('A');
  const b = await folders.create('B');
  await folders.change(a.id, { add: [shared.slug, alone.slug], remove: [] });
  await folders.change(b.id, { add: [shared.slug], remove: [] });
  const answer = await server.request(`/folders/${a.id}`, { method: 'DELETE' });
  assert.equal(answer.status, 200);
  assert.deepEqual((await answer.json()) as DeleteFolderResponse, { ok: true, designs: 2, onlyHere: 1 });
});

test('an agent request naming a deleted folder reports it as unknown and files nothing', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const folders = ensureFoldersService(core.ctx);
  const design = await core.store.create({ kind: 'page', title: 'Pricing' });
  const old = await folders.create('Old ideas');
  await folders.remove(old.id);
  assert.deepEqual(await folders.changeByName(design.slug, { add: ['old IDEAS'], remove: [] }), { unknown: ['old IDEAS'] });
  // Undo still brings it back empty: the request did not slip the design into it.
  assert.deepEqual((await folders.undelete(old.id)).slugs, []);
});

test('the composed service acts on an agent folderRequest end to end (compose wiring)', async (t) => {
  const tmp = await useTmpRoot(t);
  const root = tmp.at('designs');
  await mkdir(root, { recursive: true });
  const settingsPath = tmp.at('settings.json');
  await writeFile(settingsPath, `${JSON.stringify({ version: 1, root })}\n`, 'utf8');
  const quiet = (): void => {};
  const log: Logger = { info: quiet, warn: quiet, error: quiet };
  const service = await composeService({ token: 'qa-token', log, packageRoot: REPO_ROOT, version: '0.0.0-test', env: { DC_SETTINGS_PATH: settingsPath }, homeDir: tmp.at('home') });
  t.after(() => service.dispose());
  const folders = ensureFoldersService(service.ctx);
  const q4 = await folders.create('Q4 launch');
  const record = await service.ctx.store.create({ kind: 'page', title: 'Pricing', brief: '', preset: null, projectDirectory: null });
  const file = path.join(record.path, 'design.json');
  const design = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  // The agent's write; the watcher's design event drives the reconciler.
  await writeFile(file, `${JSON.stringify({ ...design, folderRequest: { add: ['q4 launch'] } }, null, 2)}\n`);
  const deadline = Date.now() + 15_000;
  let slugs: string[] = [];
  while (Date.now() < deadline) {
    slugs = (await folders.list()).folders.find((entry) => entry.id === q4.id)?.slugs ?? [];
    if (slugs.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(slugs, [record.slug]);
});
