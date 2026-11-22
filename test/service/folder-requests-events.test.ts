// The agent's folderRequest after QA-F (documentation/specs/phase-2-6-technical.md §5.4, §8, §13;
// KI-25, KI-26). Each test fails when its guard is removed:
// - the warning reaches the guests: a `comments` event follows the state.json write (never
//   before it), a repeat of the same request emits nothing, and the event makes no version;
// - a request that waited on a damaged folders.json lands once the user's folder action repairs
//   it, with no further design edit (KI-25);
// - a request written while the service was down, or in a designs folder the user switches to,
//   is acted on by the sweep after the watcher's baseline (KI-26);
// - a membership batch that changes nothing writes nothing (no rev bump, no event).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { ChangeEvent } from '../../src/shared/types.ts';
import { composeService, type ComposedService } from '../../src/service/compose.ts';
import type { Logger } from '../../src/service/context.ts';
import { createFolderRequestReconciler } from '../../src/service/folder-requests.ts';
import { ensureFoldersService } from '../../src/service/folders.ts';
import { createVersionsService } from '../../src/service/versions.ts';
import { useTmpRoot, type TmpRoot } from '../helpers/tmp-root.ts';
import { createCore, REPO_ROOT } from './core/harness.ts';

const quiet = (): void => {};
const LOG: Logger = { info: quiet, warn: quiet, error: quiet };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` answers a value (15 s cap, then the last answer is asserted by the caller). */
const until = async <T>(check: () => Promise<T | undefined>): Promise<T | undefined> => {
  const deadline = Date.now() + 15_000;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await check();
    if (last !== undefined) return last;
    await sleep(25);
  }
  return last;
};

/** A composed service over `root`, with its own settings file (so two services never share one). */
const compose = async (t: TestContext, tmp: TmpRoot, root: string, name: string): Promise<ComposedService> => {
  await mkdir(root, { recursive: true });
  const settingsPath = tmp.at(`${name}-settings.json`);
  await writeFile(settingsPath, `${JSON.stringify({ version: 1, root })}\n`, 'utf8');
  const service = await composeService({ token: 'qa-token', log: LOG, packageRoot: REPO_ROOT, version: '0.0.0-test', env: { DC_SETTINGS_PATH: settingsPath }, homeDir: tmp.at('home') });
  t.after(() => service.dispose());
  return service;
};

/** The agent's write: design.json gains (or changes) `folderRequest`, everything else kept. */
const agentWrites = async (designDir: string, folderRequest: unknown): Promise<void> => {
  const file = path.join(designDir, 'design.json');
  const design = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  await writeFile(file, `${JSON.stringify({ ...design, folderRequest }, null, 2)}\n`);
};

const membersOf = async (service: ComposedService, name: string): Promise<string[] | undefined> =>
  (await ensureFoldersService(service.ctx).list()).folders.find((folder) => folder.name === name)?.slugs;

test('the warning reaches the guests: a comments event after the state write, once per request', async (t) => {
  const tmp = await useTmpRoot(t);
  const service = await compose(t, tmp, tmp.at('designs'), 'a');
  const record = await service.ctx.store.create({ kind: 'page', title: 'Pricing', brief: '', preset: null, projectDirectory: null });
  const stateFile = path.join(record.path, '.chamber', 'state.json');
  /** What state.json held at the moment each `comments` event for the design was emitted. */
  const seen: unknown[] = [];
  service.ctx.hub.subscribe((event: ChangeEvent) => {
    if (event.slug !== record.slug || event.kind !== 'comments') return;
    seen.push((JSON.parse(readFileSync(stateFile, 'utf8')) as { folderRequestProblem?: unknown }).folderRequestProblem);
  });

  // No folder is called Q4: the request becomes a warning, written to state.json only.
  await agentWrites(record.path, { add: ['Q4'] });
  const count = await until(async () => (seen.length > 0 ? seen.length : undefined));
  assert.equal(count, 1);
  assert.deepEqual(seen, [{ unknown: ['Q4'] }]);
  // Guest-visible: the long-poll answers it.
  const answer = await service.ctx.hub.waitFor(0, service.ctx.epoch, 0);
  assert.ok(answer.events.some((event) => event.slug === record.slug && event.kind === 'comments'));

  // The same request again (an echo of design.json) acts on nothing and announces nothing.
  service.ctx.hub.emit({ slug: record.slug, kind: 'design' });
  service.ctx.hub.emit({ slug: record.slug, kind: 'design' });
  await sleep(300);
  assert.equal(seen.length, 1);

  // A clean request clears the warning, and that is announced too.
  await ensureFoldersService(service.ctx).create('Q4');
  await agentWrites(record.path, { add: ['q4'] });
  await until(async () => (seen.length > 1 ? true : undefined));
  assert.deepEqual(seen, [{ unknown: ['Q4'] }, undefined]);
  assert.deepEqual(await membersOf(service, 'Q4'), [record.slug]);
});

test('the announcement is not content: it never makes a version', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const versions = createVersionsService({ store: core.store, hub: core.ctx.hub, log: core.ctx.log, onDispose: core.ctx.onDispose, quietMs: 20 });
  const record = await core.store.create({ kind: 'page', title: 'Pricing' });
  await sleep(150);
  const before = (await versions.list(record.slug)).versions.length;
  const events: ChangeEvent[] = [];
  core.ctx.hub.subscribe((event) => void events.push(event));

  // design.json changes with no event (no watcher here); only the reconciler's announcement fires.
  await agentWrites(record.path, { add: ['Q4'] });
  const reconciler = createFolderRequestReconciler({ ctx: core.ctx });
  t.after(() => reconciler.stop());
  await reconciler.reconcile(record.slug);
  await sleep(200);
  // Past the quiet period: an event the versions service counted would have snapshotted the new design.json.
  assert.equal((await versions.list(record.slug)).versions.length, before);
  assert.deepEqual(
    events.map((event) => [event.slug, event.kind]),
    [[record.slug, 'comments']],
  );
});

test('KI-25: a request that waited on a damaged folders.json lands after the user repairs it, with no design edit', async (t) => {
  const tmp = await useTmpRoot(t);
  const root = tmp.at('designs');
  // The design exists before this service starts, so its watcher only reports the agent's write.
  const seed = await compose(t, tmp, root, 'seed');
  const record = await seed.ctx.store.create({ kind: 'page', title: 'Pricing', brief: '', preset: null, projectDirectory: null });
  await seed.dispose();
  const registry = path.join(root, '.chamber', 'folders.json');
  await mkdir(path.dirname(registry), { recursive: true });
  await writeFile(registry, '{ damaged');

  const service = await compose(t, tmp, root, 'a');
  const events: ChangeEvent[] = [];
  service.ctx.hub.subscribe((event) => void events.push(event));
  await agentWrites(record.path, { add: ['Q4'] });
  const waiting = await until(async () => ((await service.ctx.store.get(record.slug)).state.folderRequestProblem?.waiting === true ? true : undefined));
  assert.equal(waiting, true);
  assert.equal(await readFile(registry, 'utf8'), '{ damaged');
  // Let the watcher settle (its debounce is 250 ms), so no late event of the agent's write is left.
  let count = -1;
  while (count !== events.length) {
    count = events.length;
    await sleep(600);
  }
  const from = events.length;

  // The user's folder action sets the damaged file aside and writes a fresh registry; nothing else happens.
  await ensureFoldersService(service.ctx).create('Q4');
  const members = await until(async () => {
    const slugs = await membersOf(service, 'Q4');
    return slugs !== undefined && slugs.length > 0 ? slugs : undefined;
  });
  assert.deepEqual(members, [record.slug]);
  const cleared = await until(async () => ((await service.ctx.store.get(record.slug)).state.folderRequestProblem === undefined ? true : undefined));
  assert.equal(cleared, true);
  // No design event drove it: the registry write did.
  assert.deepEqual(
    events.slice(from).filter((event) => event.slug === record.slug && (event.kind === 'design' || event.kind === 'added')),
    [],
  );
});

test('KI-26: a request written while the service was down is acted on at the next start', async (t) => {
  const tmp = await useTmpRoot(t);
  const root = tmp.at('designs');
  const first = await compose(t, tmp, root, 'a');
  await ensureFoldersService(first.ctx).create('Q4');
  const record = await first.ctx.store.create({ kind: 'page', title: 'Pricing', brief: '', preset: null, projectDirectory: null });
  await first.dispose();

  // The agent files it while OpenChamber is closed.
  await agentWrites(record.path, { add: ['Q4'] });
  const second = await compose(t, tmp, root, 'b');
  const members = await until(async () => {
    const slugs = await membersOf(second, 'Q4');
    return slugs !== undefined && slugs.length > 0 ? slugs : undefined;
  });
  assert.deepEqual(members, [record.slug]);
});

test('KI-26: switching to a designs folder that holds a request acts on it after the new baseline', async (t) => {
  const tmp = await useTmpRoot(t);
  const other = tmp.at('other');
  const seed = await compose(t, tmp, other, 'seed');
  await ensureFoldersService(seed.ctx).create('Q4');
  const record = await seed.ctx.store.create({ kind: 'page', title: 'Pricing', brief: '', preset: null, projectDirectory: null });
  await seed.dispose();
  await agentWrites(record.path, { add: ['Q4'] });

  const service = await compose(t, tmp, tmp.at('designs'), 'a');
  await service.ctx.settings.update({ root: other });
  const members = await until(async () => {
    const slugs = await membersOf(service, 'Q4');
    return slugs !== undefined && slugs.length > 0 ? slugs : undefined;
  });
  assert.deepEqual(members, [record.slug]);
});

test('a membership batch that changes nothing writes nothing: no rev bump, no event', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const folders = ensureFoldersService(core.ctx);
  const member = await core.store.create({ kind: 'page', title: 'Pricing' });
  const outsider = await core.store.create({ kind: 'page', title: 'Notes' });
  const q4 = await folders.create('Q4');
  await folders.changeMany([{ target: { kind: 'folder', id: q4.id }, add: [member.slug], remove: [] }], { atomic: false });
  const file = path.join(core.root, '.chamber', 'folders.json');
  const text = await readFile(file, 'utf8');
  const events: string[] = [];
  core.ctx.hub.subscribe((event) => void events.push(event.kind));

  // Re-add an existing member; remove a design that is not a member.
  const again = await folders.changeMany(
    [
      { target: { kind: 'folder', id: q4.id }, add: [member.slug], remove: [] },
      { target: { kind: 'folder', id: q4.id }, add: [], remove: [outsider.slug] },
    ],
    { atomic: false },
  );
  assert.deepEqual(
    again.results.map((result) => result.ok),
    [true, true],
  );
  // The agent's request for a membership that is already true.
  assert.deepEqual(await folders.changeByName(member.slug, { add: ['q4'], remove: [] }), { unknown: [] });
  assert.equal(await readFile(file, 'utf8'), text);
  assert.deepEqual(events, []);
});
