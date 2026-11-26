// The agent's recorded `systemChoice` gets the same sweep as a folder request (Phase 2.5 §5.5,
// Phase 2.6 KI-26 parity): a choice written while the service was down, or in a designs folder the
// user switches to, is acted on once the watcher's baseline is seeded; the sweep waits for the NEW
// baseline after a root change; a choice already acted on is left alone (no write, no event, no
// version), and the announcement it makes never re-triggers it.

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { ChangeEvent } from '../../../src/shared/types.ts';
import { composeService, type ComposedService } from '../../../src/service/compose.ts';
import type { Logger } from '../../../src/service/context.ts';
import { createChoiceReconciler } from '../../../src/service/systems/choice.ts';
import type { LinkService } from '../../../src/service/systems/link.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { createCore, REPO_ROOT } from '../core/harness.ts';

const quiet = (): void => {};
const LOG: Logger = { info: quiet, warn: quiet, error: quiet };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` answers a value (15 s cap). */
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

const compose = async (t: TestContext, tmp: TmpRoot, root: string, name: string): Promise<ComposedService> => {
  await mkdir(root, { recursive: true });
  const settingsPath = tmp.at(`${name}-settings.json`);
  await writeFile(settingsPath, `${JSON.stringify({ version: 1, root })}\n`, 'utf8');
  const service = await composeService({ token: 'qa-token', log: LOG, packageRoot: REPO_ROOT, version: '0.0.0-test', env: { DC_SETTINGS_PATH: settingsPath }, homeDir: tmp.at('home') });
  t.after(() => service.dispose());
  return service;
};

/** The agent's write: design.json gains (or changes) `systemChoice`, everything else kept. */
const agentChooses = async (designDir: string, systemChoice: string): Promise<void> => {
  const file = path.join(designDir, 'design.json');
  const design = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  await writeFile(file, `${JSON.stringify({ ...design, systemChoice }, null, 2)}\n`);
};

/** A design made by a service that is then shut down (so the next service's watcher has it in its baseline). */
const seedDesign = async (t: TestContext, tmp: TmpRoot, root: string): Promise<{ slug: string; path: string }> => {
  const seed = await compose(t, tmp, root, `seed-${path.basename(root)}`);
  const record = await seed.ctx.store.create({ kind: 'page', title: 'Checkout', brief: '', preset: null, projectDirectory: null });
  await seed.dispose();
  return { slug: record.slug, path: record.path };
};

/** A link service that knows no systems: every id is unknown (the reconciler records a problem). */
const noSystems = { indexed: async () => [], link: async () => assert.fail('no link expected') } as unknown as LinkService;

test('a choice written while the service was down is acted on at the next start, and only once', async (t) => {
  const tmp = await useTmpRoot(t);
  const root = tmp.at('designs');
  const design = await seedDesign(t, tmp, root);
  // The agent records the user's answer while OpenChamber is closed (no system has that id).
  await agentChooses(design.path, 'acme');

  const second = await compose(t, tmp, root, 'second');
  const events: ChangeEvent[] = [];
  second.ctx.hub.subscribe((event) => void events.push(event));
  const state = await until(async () => {
    const now = (await second.ctx.store.get(design.slug)).state;
    return now.systemChoiceProblem !== undefined ? now : undefined;
  });
  assert.deepEqual(state?.systemChoiceProblem, { value: 'acme', reason: 'unknown' });
  assert.equal(state?.systemChoiceSeen, 'acme');
  // The announcement does not feed back into the reconciler: one event, then quiet.
  await sleep(400);
  assert.equal(events.filter((event) => event.slug === design.slug && event.kind === 'comments').length, 1);
  await second.dispose();

  // A third start finds the choice already acted on: nothing is written and nothing is announced.
  const stateFile = path.join(design.path, '.chamber', 'state.json');
  const before = await readFile(stateFile, 'utf8');
  const third = await compose(t, tmp, root, 'third');
  const later: ChangeEvent[] = [];
  third.ctx.hub.subscribe((event) => void later.push(event));
  await sleep(600);
  assert.equal(await readFile(stateFile, 'utf8'), before);
  assert.deepEqual(
    later.filter((event) => event.slug === design.slug),
    [],
  );
});

test('switching to a designs folder that holds a recorded choice acts on it after the new baseline', async (t) => {
  const tmp = await useTmpRoot(t);
  const other = tmp.at('other');
  const design = await seedDesign(t, tmp, other);
  await agentChooses(design.path, 'none');

  const service = await compose(t, tmp, tmp.at('designs'), 'a');
  await service.ctx.settings.update({ root: other });
  const decision = await until(async () => {
    const state = (await service.ctx.store.get(design.slug)).state;
    return state.systemChoiceSeen === 'none' ? state.systemDecision : undefined;
  });
  assert.equal(decision, 'none');
});

test('the sweep and its announcement make no version', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const quietMs = 20;
  const versions = createVersionsService({ store: core.store, hub: core.ctx.hub, log: core.ctx.log, onDispose: core.ctx.onDispose, quietMs });
  const events: ChangeEvent[] = [];
  core.ctx.hub.subscribe((event) => void events.push(event));
  const record = await core.store.create({ kind: 'page', title: 'Checkout' });
  // Wait for the create's own snapshot to be announced, not just committed. snapshotNow emits
  // 'versions' only after its garbage-collection pass (versions.ts), so under runner load the emit
  // can trail the commit by more than any fixed sleep taken after it; the late announcement then
  // lands in the assertion window below and reads as a version the sweep made (CI flake). Watching
  // for the emit itself means nothing create-related can land after we clear the slate.
  await until(async () => (events.some((event) => event.slug === record.slug && event.kind === 'versions') ? true : undefined));
  const before = (await versions.list(record.slug)).versions.length;
  events.length = 0;

  // design.json changes with no event (no watcher here); only the sweep finds it.
  await agentChooses(record.path, 'acme');
  const reconciler = createChoiceReconciler({ ctx: core.ctx, link: noSystems, retryMs: 5, ready: async () => {} });
  t.after(() => reconciler.stop());
  await reconciler.idle();
  assert.deepEqual((await core.store.get(record.slug)).state.systemChoiceProblem, { value: 'acme', reason: 'unknown' });
  await sleep(200);
  // Past the quiet period: an event the versions service counted would have snapshotted the new design.json.
  assert.equal((await versions.list(record.slug)).versions.length, before);
  assert.deepEqual(
    events.map((event) => [event.slug, event.kind]),
    [[record.slug, 'comments']],
  );
});

test('after a root change the sweep waits for the new baseline, and a sweep of the old root stops', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const listed: string[] = [];
  const realList = core.store.list.bind(core.store);
  core.store.list = async (...args) => {
    listed.push(core.ctx.settings.root());
    return realList(...args);
  };
  type Deferred = { promise: Promise<void>; resolve: () => void };
  const deferred = (): Deferred => {
    let resolve = (): void => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const first = deferred();
  let current = first.promise;
  const reconciler = createChoiceReconciler({ ctx: core.ctx, link: noSystems, retryMs: 5, ready: () => current });
  t.after(() => reconciler.stop());

  // The root changes while the first baseline is still being read; the watcher swaps in the new
  // baseline right after it emits `root` (in the same turn), exactly like watch.ts.
  const second = deferred();
  core.ctx.hub.emit({ slug: null, kind: 'root' });
  current = second.promise;
  first.resolve();
  await sleep(30);
  assert.deepEqual(listed, [], 'neither sweep lists before the new baseline');

  second.resolve();
  await reconciler.idle();
  assert.equal(listed.length, 1, 'only the new root is swept');
});
