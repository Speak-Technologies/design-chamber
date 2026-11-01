// Two-writer race on design.json (review 2026-10-27, M1; §6.3): a service write (add comment,
// rename, mark-sent) merges into design.json while the agent may be rewriting it. The mirror
// replaces the file only while it still holds the text it was merged from, so an agent write
// landing mid-merge is re-merged, never overwritten.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';

import { createChangeHub } from '../../../src/service/changes.ts';
import type { ChangeHub, Logger, SettingsStore } from '../../../src/service/context.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

test('M1 — an agent design.json write concurrent with a comment is never lost', async (t) => {
  const tmp = await useTmpRoot(t);
  const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const settings: SettingsStore = {
    root: () => tmp.root,
    defaultRoot: () => tmp.root,
    read: () => ({ version: 1, root: tmp.root }),
    update: async () => {
      throw new Error('unused');
    },
    onRootChange: () => () => undefined,
  };
  const store = createDesignStore({ settings, log });
  const record = await store.create({ kind: 'canvas', title: 'Race' });
  const designFile = tmp.at(`${record.slug}/design.json`);

  let lost = 0;
  let failed = 0;
  let comments = 0;
  const rounds = 60;
  for (let round = 1; round <= rounds; round += 1) {
    const screens = Array.from({ length: round }, (_, n) => ({ id: `s${n}`, title: `S${n}`, file: `screens/s${n}.html` }));
    // The agent rewrites design.json (atomically, as a careful agent would) adding one screen.
    const agentWrite = (async () => {
      const current = JSON.parse(await readFile(designFile, 'utf8')) as Record<string, unknown>;
      const tmpFile = `${designFile}.agent.tmp`;
      await writeFile(tmpFile, JSON.stringify({ ...current, screens }, null, 2));
      await rename(tmpFile, designFile);
    })();
    const comment = store.addComment(record.slug, {
      screen: null,
      viewport: 'laptop',
      anchor: { selector: 'body', text: '', html: '', rect: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0, y: 0 } },
      body: `comment ${round}`,
    } as Parameters<typeof store.addComment>[1]);
    const [agentResult, commentResult] = await Promise.allSettled([agentWrite, comment]);
    if (commentResult.status === 'fulfilled') comments += 1;
    // Only count rounds where both writers succeeded: a lost write here is silent.
    if (agentResult.status === 'rejected' || commentResult.status === 'rejected') {
      failed += 1;
      continue;
    }
    const after = JSON.parse(await readFile(designFile, 'utf8')) as { screens?: unknown[] };
    if ((after.screens ?? []).length !== round) {
      lost += 1;
      // Put the agent's intent back so the next round starts from it (as the agent would retry).
      const fixed = JSON.parse(await readFile(designFile, 'utf8')) as Record<string, unknown>;
      await writeFile(designFile, JSON.stringify({ ...fixed, screens }, null, 2));
    }
  }
  assert.ok(failed < rounds / 2, `${failed} of ${rounds} rounds failed outright`);
  assert.equal(lost, 0, `${lost} of ${rounds - failed} agent writes to design.json were silently overwritten by a concurrent comment`);
  // Every comment the service accepted is still in state.json (the truth).
  const state = await store.get(record.slug);
  assert.equal(state.design.comments.length, comments);
});

// ---- Take-over without clobbering (§6.3 P1, P2; documentation/specs/agent-guidance-and-pages.md §3.2) ----
// The agent writes its HTML before design.json. The watcher sees the folder first, so the
// service seeds state.json from the files; that seed must be provisional and give way to the
// agent's design.json when it lands, never overwrite it.

type TakeoverEnv = {
  tmp: Awaited<ReturnType<typeof useTmpRoot>>;
  hub: ChangeHub;
  store: ReturnType<typeof createDesignStore>;
  readJson(relative: string): Promise<Record<string, unknown>>;
};

const takeoverEnv = async (t: TestContext): Promise<TakeoverEnv> => {
  const tmp = await useTmpRoot(t);
  const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const settings: SettingsStore = {
    root: () => tmp.root,
    defaultRoot: () => tmp.root,
    read: () => ({ version: 1, root: tmp.root }),
    update: async () => {
      throw new Error('unused');
    },
    onRootChange: () => () => undefined,
  };
  const hub = createChangeHub(randomUUID());
  const store = createDesignStore({ settings, log, hub });
  return { tmp, hub, store, readJson: async (relative) => JSON.parse(await tmp.read(relative)) as Record<string, unknown> };
};

const missing = async (file: string): Promise<boolean> => stat(file).then(() => false, () => true);

/** What a careful agent writes once it gets round to design.json (no version, no comments). */
const agentDesignJson = {
  kind: 'canvas',
  title: 'Checkout',
  brief: 'A calmer checkout for a coffee shop',
  projectDirectory: '/home/me/projects/coffee',
  viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }],
  screens: [{ id: 'home', title: 'Home', file: 'screens/home.html' }],
};

const assertAdopted = async (env: TakeoverEnv, slug: string): Promise<void> => {
  const design = await env.readJson(`${slug}/design.json`);
  // The agent's values, byte for byte, for every key it wrote.
  for (const [key, value] of Object.entries(agentDesignJson)) assert.deepEqual(design[key], value, `design.json ${key}`);
  // The merge only added the service keys the agent left out.
  assert.equal(design.version, 1);
  assert.deepEqual(design.comments, []);
  const state = await env.readJson(`${slug}/.chamber/state.json`);
  assert.equal(state.kind, 'canvas');
  assert.equal(state.brief, agentDesignJson.brief);
  assert.equal(state.projectDirectory, agentDesignJson.projectDirectory);
  assert.equal(state.entry, null);
  assert.equal(Object.hasOwn(state, 'provisional'), false, 'the provisional flag is gone once adopted');
};

test('P1 — a folder with only index.html gets a provisional state.json and no invented design.json', async (t) => {
  const env = await takeoverEnv(t);
  await env.tmp.write('early/index.html', '<h1>Early</h1>');
  await env.store.reconcile('early');
  const state = await env.readJson('early/.chamber/state.json');
  assert.equal(state.provisional, true);
  assert.equal(state.kind, 'page');
  assert.equal(state.brief, '');
  assert.ok(await missing(env.tmp.at('early/design.json')), 'reconcile must not create design.json');
});

test('P2 — the agent\'s design.json landing after the HTML is adopted, not overwritten', async (t) => {
  const env = await takeoverEnv(t);
  await env.tmp.write('early/index.html', '<h1>Early</h1>');
  await env.store.reconcile('early');
  await env.tmp.write('early/design.json', agentDesignJson);
  await env.store.reconcile('early');
  await assertAdopted(env, 'early');
  const record = await env.store.get('early');
  assert.equal(record.design.kind, 'canvas');
  assert.equal(record.design.brief, agentDesignJson.brief);
});

test('P2 — a slow agent (HTML, a 2 s pause, then design.json) still keeps its values, driven by change events', async (t) => {
  const env = await takeoverEnv(t);
  const stateFile = env.tmp.at('slow/.chamber/state.json');
  const waitForState = async (predicate: (state: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 4000;
    for (;;) {
      const state = await readFile(stateFile, 'utf8').then((text) => JSON.parse(text) as Record<string, unknown>, () => null);
      if (state !== null && predicate(state)) return state;
      if (Date.now() > deadline) throw new Error(`state.json never matched; last seen ${JSON.stringify(state)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  await env.tmp.write('slow/index.html', '<h1>Slow</h1>');
  env.hub.emit({ slug: 'slow', kind: 'added' }); // what the watcher reports for the new folder
  await waitForState((state) => state.provisional === true);
  await new Promise((resolve) => setTimeout(resolve, 2000)); // the agent thinks
  await env.tmp.write('slow/design.json', agentDesignJson);
  env.hub.emit({ slug: 'slow', kind: 'design' });
  await waitForState((state) => !Object.hasOwn(state, 'provisional'));
  await assertAdopted(env, 'slow');
});

test('P2 — HTML first, then a design.json listing screens but no kind, is adopted as the canvas it describes (KI-6)', async (t) => {
  const env = await takeoverEnv(t);
  await env.tmp.write('nokind/index.html', '<h1>Early</h1>');
  await env.store.reconcile('nokind');
  assert.equal((await env.readJson('nokind/.chamber/state.json')).kind, 'page');
  await env.tmp.write('nokind/design.json', { title: 'Checkout', screens: [{ id: 'home', title: 'Home', file: 'screens/home.html' }] });
  await env.store.reconcile('nokind');
  const state = await env.readJson('nokind/.chamber/state.json');
  assert.equal(state.kind, 'canvas');
  assert.equal(Object.hasOwn(state, 'provisional'), false);
  const record = await env.store.get('nokind');
  assert.equal(record.design.kind, 'canvas');
  assert.deepEqual(record.design.screens.map((screen) => screen.id), ['home']);
  assert.equal(record.warnings.some((warning) => warning.code === 'screens-ignored'), false, 'the screen list is not ignored');
});

test('P1 — a half-written design.json with no state seeds a provisional state; the finished file is adopted', async (t) => {
  const env = await takeoverEnv(t);
  await env.tmp.write('midway/index.html', '<h1>Midway</h1>');
  await env.tmp.write('midway/design.json', '{"kind": "canvas", "brief": "A calmer');
  await env.store.reconcile('midway');
  assert.equal((await env.readJson('midway/.chamber/state.json')).provisional, true);
  assert.equal(await env.tmp.read('midway/design.json'), '{"kind": "canvas", "brief": "A calmer', 'an unparseable file is never written over');
  await env.tmp.write('midway/design.json', agentDesignJson);
  await env.store.reconcile('midway');
  await assertAdopted(env, 'midway');
});
