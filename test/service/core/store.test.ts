// The designs store (docs/SPEC.md §9.3) and the two-writer merge (§6.3): state.json is the
// service-owned truth, design.json carries the mirror, an agent overwrite that drops the
// comments is re-merged, an unparseable design.json is never written over, and equal bytes
// are never rewritten (no watch loop).

import assert from 'node:assert/strict';
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { ApiError } from '../../../src/service/http.ts';
import { createChangeHub } from '../../../src/service/changes.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import type { ChangeHub, Logger, SettingsStore } from '../../../src/service/context.ts';
import { COMMENTS_MAX } from '../../../src/shared/limits.ts';
import { serializeJson } from '../../../src/shared/design-json.ts';
import type { ChangeEvent, Comment, ServiceState } from '../../../src/shared/types.ts';
import { refuseRenames } from '../../helpers/refuse-rename.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import type { LogLine } from './harness.ts';

type StoreEnv = {
  tmp: TmpRoot;
  logs: LogLine[];
  hub: ChangeHub;
  events: ChangeEvent[];
  store: ReturnType<typeof createDesignStore>;
  settings: SettingsStore;
};

const makeEnv = async (t: TestContext): Promise<StoreEnv> => {
  const tmp = await useTmpRoot(t);
  const logs: LogLine[] = [];
  const log: Logger = {
    info: (event, fields) => void logs.push({ level: 'info', event, fields }),
    warn: (event, fields) => void logs.push({ level: 'warn', event, fields }),
    error: (event, fields) => void logs.push({ level: 'error', event, fields }),
  };
  const hub = createChangeHub(randomUUID());
  const events: ChangeEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const root = tmp.root;
  const rootListeners = new Set<(next: string, previous: string) => void>();
  const settings: SettingsStore = {
    root: () => root,
    defaultRoot: () => root,
    read: () => ({ version: 1, root }),
    async update() {
      throw new Error('not used in store tests');
    },
    onRootChange(listener) {
      rootListeners.add(listener);
      return () => rootListeners.delete(listener);
    },
  };
  const store = createDesignStore({ settings, log, hub });
  return { tmp, logs, hub, events, store, settings };
};

const readJson = async (file: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

const seededState = (over: Partial<ServiceState> = {}): ServiceState => ({
  version: 1,
  kind: 'canvas',
  created: '2026-10-01T00:00:00.000Z',
  brief: '',
  sessionId: null,
  projectDirectory: null,
  preset: null,
  entry: null,
  comments: [],
  ...over,
});

const commentFixture = (id: string, body = 'Pin body'): Comment => ({
  id,
  screen: null,
  viewport: 'laptop',
  anchor: { selector: 'main > h1', text: 'Ship faster', html: '<h1>', rect: { x: 1, y: 2, w: 3, h: 4 }, point: { x: 0.5, y: 0.5 } },
  body,
  status: 'open',
  created: '2026-10-01T00:00:00.000Z',
  sentAt: null,
  sentVersion: null,
});

describe('create', () => {
  test('a canvas gets a folder, state.json, design.json and fires "added"', async (t) => {
    const env = await makeEnv(t);
    const record = await env.store.create({ kind: 'canvas', title: 'Checkout Redesign', brief: 'Calmer checkout' });
    assert.equal(record.slug, 'checkout-redesign');
    assert.equal(record.path, path.join(env.tmp.root, 'checkout-redesign'));
    assert.equal(record.design.kind, 'canvas');
    assert.equal(record.design.title, 'Checkout Redesign');
    assert.equal(record.design.brief, 'Calmer checkout');
    assert.deepEqual(record.design.viewports.map((viewport) => viewport.id), ['laptop', 'phone']);
    assert.equal(record.pending, true);

    const designJson = await readJson(path.join(record.path, 'design.json'));
    assert.equal(designJson.kind, 'canvas');
    assert.deepEqual(designJson.comments, []);
    const state = await readJson(path.join(record.path, '.chamber', 'state.json'));
    assert.equal(state.kind, 'canvas');
    assert.deepEqual(env.events.map((event) => [event.slug, event.kind]), [[record.slug, 'added']]);
  });

  test('an artifact with inline html writes index.html and is not pending', async (t) => {
    const env = await makeEnv(t);
    const record = await env.store.create({ kind: 'page', title: 'Landing', html: '<!doctype html><h1>Hi</h1>' });
    assert.equal(record.pending, false);
    assert.equal(record.design.entry, 'index.html');
    assert.equal(await readFile(path.join(record.path, 'index.html'), 'utf8'), '<!doctype html><h1>Hi</h1>');
    assert.equal(record.files.entry?.exists, true);
  });

  test('the title falls back to the brief, then to "Untitled design"; slugs stay unique', async (t) => {
    const env = await makeEnv(t);
    const fromBrief = await env.store.create({ kind: 'canvas', brief: 'A pricing page\nfor coffee' });
    assert.equal(fromBrief.design.title, 'A pricing page');
    assert.equal(fromBrief.slug, 'a-pricing-page');
    const untitled = await env.store.create({ kind: 'page' });
    assert.equal(untitled.design.title, 'Untitled design');
    assert.equal(untitled.slug, 'untitled-design');

    const second = await env.store.create({ kind: 'canvas', title: 'A pricing page' });
    assert.equal(second.slug, 'a-pricing-page-2');
    const third = await env.store.create({ kind: 'canvas', title: 'A pricing page' });
    assert.equal(third.slug, 'a-pricing-page-3');
  });

  test('onCreate hooks run; a failing hook is logged and never undoes the create', async (t) => {
    const env = await makeEnv(t);
    const seen: string[] = [];
    env.store.onCreate(async (record) => void seen.push(record.slug));
    env.store.onCreate(async () => {
      throw new Error('RULES.md exploded');
    });
    const record = await env.store.create({ kind: 'canvas', title: 'Hooked' });
    assert.deepEqual(seen, [record.slug]);
    assert.ok((await stat(path.join(record.path, 'design.json'))).isFile());
    assert.ok(env.logs.some((line) => line.level === 'warn' && line.event === 'store.create-hook-failed'));
  });

  test('a brief longer than the cap is truncated, and sessionId/preset/project land in state', async (t) => {
    const env = await makeEnv(t);
    const record = await env.store.create({
      kind: 'page',
      title: 'Meta',
      brief: 'x'.repeat(5000),
      sessionId: 'ses_123',
      preset: 'minimal-saas',
      projectDirectory: 'C:\\Projects\\shop',
    });
    assert.equal(record.design.brief.length, 2000);
    assert.equal(record.design.sessionId, 'ses_123');
    assert.equal(record.design.preset, 'minimal-saas');
    assert.equal(record.design.projectDirectory, 'C:\\Projects\\shop');
  });
});

describe('get / read tolerance', () => {
  test('state.json wins over design.json for service-owned fields', async (t) => {
    const env = await makeEnv(t);
    await env.tmp.writeDesign('liar', {
      'design.json': { version: 1, kind: 'page', title: 'Agent title', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-02T00:00:00.000Z', sessionId: 'ses_lie', comments: [] },
      '.chamber/state.json': seededState({ kind: 'page', sessionId: 'ses_truth', created: '2026-01-01T00:00:00.000Z' }),
      'index.html': '<h1>hi</h1>',
    });
    const record = await env.store.get('liar');
    assert.equal(record.design.sessionId, 'ses_truth');
    assert.equal(record.design.title, 'Agent title'); // agent-owned
    assert.equal(record.design.kind, 'page');
    assert.equal(record.pending, false);
  });

  test('a folder with only index.html is an artifact with a no-design-json warning', async (t) => {
    const env = await makeEnv(t);
    await env.tmp.write('bare/index.html', '<h1>bare</h1>');
    const record = await env.store.get('bare');
    assert.equal(record.design.kind, 'page');
    assert.equal(record.design.title, 'bare'); // slug fallback
    assert.ok(record.warnings.some((warning) => warning.code === 'no-design-json'));
    assert.equal(record.pending, false);
  });

  test('a corrupt design.json reads with defaults and is never fatal', async (t) => {
    const env = await makeEnv(t);
    await env.tmp.write('broken/design.json', '{{{');
    await env.tmp.write('broken/.chamber/state.json', serializeJson(seededState({ kind: 'page' })));
    const record = await env.store.get('broken');
    assert.equal(record.design.title, 'broken');
    assert.ok(record.warnings.some((warning) => warning.code === 'invalid-json'));
  });

  test('unknown slugs and bad slugs refuse', async (t) => {
    const env = await makeEnv(t);
    await assert.rejects(env.store.get('nope'), (error: unknown) => error instanceof ApiError && error.code === 'not-found');
    for (const bad of ['UPPER', 'with.dot', '..', 'a b']) {
      await assert.rejects(env.store.get(bad), (error: unknown) => error instanceof ApiError && error.code === 'bad-slug', bad);
    }
  });

  test('a corrupt state.json is rebuilt from design.json', async (t) => {
    const env = await makeEnv(t);
    await env.tmp.write('healed/design.json', { version: 1, kind: 'canvas', title: 'Healed', comments: [commentFixture('c_aaaa1111')] });
    await env.tmp.write('healed/.chamber/state.json', 'not json at all');
    const record = await env.store.get('healed');
    assert.equal(record.design.comments.length, 1);
    assert.ok(env.logs.some((line) => line.event === 'store.state-unparseable'));
    await env.store.reconcile('healed');
    const healed = await readJson(path.join(record.path, '.chamber', 'state.json'));
    assert.equal(healed.kind, 'canvas');
    assert.equal((healed.comments as unknown[]).length, 1);
  });
});

describe('patch', () => {
  test('a user rename writes design.json title and bumps updated; state keeps service fields', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Before', sessionId: 'ses_keep' });
    const patched = await env.store.patch(created.slug, { title: 'After' });
    assert.equal(patched.design.title, 'After');
    assert.equal(patched.design.sessionId, 'ses_keep');
    const onDisk = await readJson(path.join(created.path, 'design.json'));
    assert.equal(onDisk.title, 'After');
    const state = await readJson(path.join(created.path, '.chamber', 'state.json'));
    assert.equal(state.sessionId, 'ses_keep');
    assert.ok(env.events.some((event) => event.kind === 'design' && event.slug === created.slug));
  });

  test('sessionId/projectDirectory go to state.json first, then the mirror', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Link me' });
    const patched = await env.store.patch(created.slug, { sessionId: 'ses_new', projectDirectory: 'C:\\Projects\\x' });
    assert.equal(patched.design.sessionId, 'ses_new');
    const state = await readJson(path.join(created.path, '.chamber', 'state.json'));
    assert.equal(state.sessionId, 'ses_new');
    assert.equal(state.projectDirectory, 'C:\\Projects\\x');
    const mirrored = await readJson(path.join(created.path, 'design.json'));
    assert.equal(mirrored.sessionId, 'ses_new');
    // Unlink again with null.
    const unlinked = await env.store.patch(created.slug, { sessionId: null });
    assert.equal(unlinked.design.sessionId, null);
  });
});

describe('comments (§6.2, service-owned)', () => {
  test('add lands in state.json and the design.json mirror, and fires "comments"', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'page', title: 'Pins' });
    const comment = await env.store.addComment(created.slug, {
      screen: null,
      viewport: 'laptop',
      anchor: commentFixture('c_x').anchor,
      body: 'Make this shorter',
    });
    assert.match(comment.id, /^c_[a-z0-9]{12}$/);
    assert.equal(comment.status, 'open');
    const state = await readJson(path.join(created.path, '.chamber', 'state.json'));
    assert.equal((state.comments as unknown[]).length, 1);
    const mirrored = await readJson(path.join(created.path, 'design.json'));
    assert.equal((mirrored.comments as unknown[]).length, 1);
    assert.ok(env.events.some((event) => event.kind === 'comments' && event.slug === created.slug));
  });

  test('update changes body/status, delete removes, unknown ids are not-found', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Pin flow' });
    const comment = await env.store.addComment(created.slug, { screen: null, viewport: 'laptop', anchor: commentFixture('c_x').anchor, body: 'First' });
    const edited = await env.store.updateComment(created.slug, comment.id, { body: 'Second', status: 'resolved' });
    assert.equal(edited.body, 'Second');
    assert.equal(edited.status, 'resolved');
    await assert.rejects(env.store.updateComment(created.slug, 'c_missing00', { body: 'x' }), (error: unknown) => error instanceof ApiError && error.code === 'not-found');
    await env.store.deleteComment(created.slug, comment.id);
    await assert.rejects(env.store.deleteComment(created.slug, comment.id), (error: unknown) => error instanceof ApiError && error.code === 'not-found');
    const record = await env.store.get(created.slug);
    assert.deepEqual(record.design.comments, []);
  });

  test('markSent stamps status/sentAt/sentVersion for the found ids only', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Send' });
    const a = await env.store.addComment(created.slug, { screen: null, viewport: 'laptop', anchor: commentFixture('c_x').anchor, body: 'a' });
    const b = await env.store.addComment(created.slug, { screen: null, viewport: 'laptop', anchor: commentFixture('c_y').anchor, body: 'b' });
    const marked = await env.store.markSent(created.slug, [a.id, 'c_nope0000'], 7);
    assert.equal(marked.length, 1);
    assert.equal(marked[0]?.status, 'sent');
    assert.equal(marked[0]?.sentVersion, 7);
    assert.ok(marked[0]?.sentAt !== null);
    const record = await env.store.get(created.slug);
    assert.equal(record.design.comments.find((entry) => entry.id === b.id)?.status, 'open');
    assert.equal(record.design.comments.filter((entry) => entry.status === 'open').length, 1);
  });

  test(`the ${COMMENTS_MAX}-comment cap refuses with a conflict`, async (t) => {
    const env = await makeEnv(t);
    const full = Array.from({ length: COMMENTS_MAX }, (_unused, index) => commentFixture(`c_full${index}`));
    await env.tmp.writeDesign('full', {
      'design.json': { version: 1, kind: 'canvas', title: 'Full', comments: full },
      '.chamber/state.json': seededState({ comments: full }),
    });
    await assert.rejects(
      env.store.addComment('full', { screen: null, viewport: 'laptop', anchor: commentFixture('c_x').anchor, body: 'one more' }),
      (error: unknown) => error instanceof ApiError && error.code === 'conflict',
    );
  });

  test('a comment on a folder without design.json creates the minimal mirror (§6.1)', async (t) => {
    const env = await makeEnv(t);
    await env.tmp.write('bare2/index.html', '<h1>bare</h1>');
    await env.tmp.write('bare2/.chamber/state.json', serializeJson(seededState({ kind: 'page', entry: 'index.html' })));
    const comment = await env.store.addComment('bare2', { screen: null, viewport: 'laptop', anchor: commentFixture('c_x').anchor, body: 'Hello' });
    const created = await readJson(env.tmp.at('bare2/design.json'));
    assert.equal(created.kind, 'page');
    assert.equal(created.entry, 'index.html');
    assert.equal((created.comments as { id: string }[])[0]?.id, comment.id);
    assert.equal(created.title, 'bare2'); // the slug fallback title
  });
});

describe('two-writer merge (§6.3)', () => {
  test('an agent overwrite that dropped the comments is re-merged; agent fields and unknown keys survive', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Merged', sessionId: 'ses_mine' });
    const comment = await env.store.addComment(created.slug, { screen: null, viewport: 'laptop', anchor: commentFixture('c_x').anchor, body: 'Keep me' });

    // The agent rewrites design.json wholesale: new title, new viewport, comments gone,
    // sessionId forged, and an unknown key the service must not touch.
    const agentVersion = {
      version: 1,
      kind: 'canvas',
      title: 'Agent renamed it',
      created: '2020-01-01T00:00:00.000Z',
      updated: '2026-10-26T12:00:00.000Z',
      sessionId: 'ses_forged',
      viewports: [{ id: 'wide', label: 'Wide', width: 1920, height: 1080 }],
      screens: [],
      designSystem: { confirmed: true },
      customAgentKey: { keep: 'me' },
    };
    await writeFile(path.join(created.path, 'design.json'), JSON.stringify(agentVersion, null, 2), 'utf8');

    await env.store.reconcile(created.slug);

    const merged = await readJson(path.join(created.path, 'design.json'));
    assert.equal(merged.title, 'Agent renamed it'); // agent-owned: kept
    assert.deepEqual(merged.viewports, agentVersion.viewports); // agent-owned: kept
    assert.equal(merged.sessionId, 'ses_mine'); // service-owned: state wins
    assert.deepEqual(merged.customAgentKey, { keep: 'me' }); // unknown key: kept
    assert.equal(merged.created, created.design.created); // service-owned: state wins
    const comments = merged.comments as { id: string; body: string }[];
    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.id, comment.id);
    assert.equal(comments[0]?.body, 'Keep me');
  });

  test('a merge of an already-merged file rewrites nothing (no watch loop)', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Stable' });
    await env.store.addComment(created.slug, { screen: null, viewport: 'laptop', anchor: commentFixture('c_x').anchor, body: 'Pin' });
    const designFile = path.join(created.path, 'design.json');
    const before = (await stat(designFile)).mtimeMs;
    const bytesBefore = await readFile(designFile, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await env.store.reconcile(created.slug);
    await env.store.reconcile(created.slug);
    const after = await stat(designFile);
    assert.equal(after.mtimeMs, before, 'design.json must not be rewritten when nothing differs');
    assert.equal(await readFile(designFile, 'utf8'), bytesBefore);
  });

  test('an unparseable design.json is NEVER written over', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Midwrite' });
    await env.store.addComment(created.slug, { screen: null, viewport: 'laptop', anchor: commentFixture('c_x').anchor, body: 'Pin' });
    const designFile = path.join(created.path, 'design.json');
    await writeFile(designFile, '{"version": 1, "title": "half-wr', 'utf8'); // agent mid-write
    await env.store.reconcile(created.slug);
    assert.equal(await readFile(designFile, 'utf8'), '{"version": 1, "title": "half-wr');
    assert.ok(env.logs.some((line) => line.event === 'store.design-json-unparseable'));
    // A service mutation keeps its truth in state.json and still leaves the file alone.
    await env.store.patch(created.slug, { sessionId: 'ses_safe' });
    assert.equal(await readFile(designFile, 'utf8'), '{"version": 1, "title": "half-wr');
    const state = await readJson(path.join(created.path, '.chamber', 'state.json'));
    assert.equal(state.sessionId, 'ses_safe');
  });

  test('reconcile of a vanished folder is a quiet no-op', async (t) => {
    const env = await makeEnv(t);
    await env.store.reconcile('gone-slug');
    assert.equal(env.logs.filter((line) => line.level === 'error').length, 0);
  });
});

describe('trash (§9.3, BRIEF Q5)', () => {
  test('delete moves the folder to .trash/<slug>-<timestamp> and fires "removed"', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Doomed' });
    const beforeBytes = await readFile(path.join(created.path, 'design.json'), 'utf8');
    const trashedTo = await env.store.trash(created.slug);
    assert.match(path.basename(trashedTo), /^doomed-\d{14}$/);
    assert.equal(path.dirname(trashedTo), path.join(env.tmp.root, '.trash'));
    assert.equal(await readFile(path.join(trashedTo, 'design.json'), 'utf8'), beforeBytes);
    await assert.rejects(env.store.get(created.slug), (error: unknown) => error instanceof ApiError && error.code === 'not-found');
    assert.ok(env.events.some((event) => event.kind === 'removed' && event.slug === created.slug));
    // The slug is free again.
    const reborn = await env.store.create({ kind: 'canvas', title: 'Doomed' });
    assert.equal(reborn.slug, 'doomed');
  });
});

describe('list', () => {
  // A root the service may not read (macOS privacy on ~/Documents behaves the same: EPERM)
  // answers a sentence instead of an empty list. chmod has no effect on win32 and root reads
  // anything, so this runs on posix as a normal user only.
  const unreadableSkip = process.platform === 'win32' ? 'chmod cannot deny a read on Windows' : process.getuid?.() === 0 ? 'root reads any folder' : false;
  test('an unreadable root is an error sentence, not an empty list', { skip: unreadableSkip }, async (t) => {
    const env = await makeEnv(t);
    await env.store.create({ kind: 'canvas', title: 'Hidden' });
    await chmod(env.tmp.root, 0o000);
    try {
      await assert.rejects(env.store.list(), (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, 'bad-path');
        assert.match(error.message, /not allowed to write|Files and Folders/);
        assert.doesNotMatch(error.message, /EACCES|EPERM|scandir/);
        return true;
      });
    } finally {
      await chmod(env.tmp.root, 0o700); // the tmp cleanup must be able to remove it
    }
  });

  test('a root that does not exist yet lists as empty', async (t) => {
    const env = await makeEnv(t);
    await rm(env.tmp.root, { recursive: true, force: true });
    assert.deepEqual(await env.store.list(), []);
  });

  test('skips dot folders and non-slug folders, filters by q/kind, and reports summaries', async (t) => {
    const env = await makeEnv(t);
    await env.store.create({ kind: 'canvas', title: 'Alpha wall' });
    await env.store.create({ kind: 'page', title: 'Beta page', html: '<h1>b</h1>' });
    await env.tmp.write('bare-artifact/index.html', '<h1>bare</h1>'); // no design.json
    await env.tmp.write('.trash/old-thing/design.json', '{}');
    await env.tmp.write('Not A Slug/design.json', '{}');

    const all = await env.store.list();
    assert.deepEqual(all.map((entry) => entry.slug).sort(), ['alpha-wall', 'bare-artifact', 'beta-page']);
    const bare = all.find((entry) => entry.slug === 'bare-artifact');
    assert.equal(bare?.kind, 'page');
    assert.equal(bare?.pending, false);
    assert.ok(bare?.warnings.some((warning) => warning.code === 'no-design-json'));

    assert.deepEqual((await env.store.list({ kind: 'canvas' })).map((entry) => entry.slug), ['alpha-wall']);
    assert.deepEqual((await env.store.list({ q: 'BETA' })).map((entry) => entry.slug), ['beta-page']);
    assert.deepEqual((await env.store.list({ q: 'wall' })).map((entry) => entry.slug), ['alpha-wall']);
    assert.deepEqual(await env.store.list({ q: 'zzz' }), []);
  });

  test('the mtime cache serves repeats but sees real changes', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Cached' });
    const first = await env.store.list();
    assert.equal(first[0]?.title, 'Cached');
    const again = await env.store.list();
    assert.equal(again[0]?.title, 'Cached');
    // The agent changes the title on disk (different size + mtime busts the cache).
    const designFile = path.join(created.path, 'design.json');
    const current = await readJson(designFile);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(designFile, JSON.stringify({ ...current, title: 'Fresh title' }, null, 2), 'utf8');
    const fresh = await env.store.list();
    assert.equal(fresh[0]?.title, 'Fresh title');
  });

  test('a missing root lists empty instead of failing', async (t) => {
    const tmp = await useTmpRoot(t);
    const hub = createChangeHub(randomUUID());
    const log: Logger = { info() {}, warn() {}, error() {} };
    const settings: SettingsStore = {
      root: () => tmp.at('never-created'),
      defaultRoot: () => tmp.at('never-created'),
      read: () => ({ version: 1 }),
      async update() {
        throw new Error('unused');
      },
      onRootChange: () => () => undefined,
    };
    const store = createDesignStore({ settings, log, hub });
    assert.deepEqual(await store.list(), []);
    await assert.rejects(store.get('anything'), (error: unknown) => error instanceof ApiError && error.code === 'not-found');
  });
});

describe('write safety', () => {
  test('every store write leaves no tmp files behind', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Clean writes' });
    await env.store.addComment(created.slug, { screen: null, viewport: 'laptop', anchor: commentFixture('c_x').anchor, body: 'Pin' });
    await env.store.patch(created.slug, { title: 'Renamed' });
    const walk = async (dir: string): Promise<string[]> => {
      const names: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) names.push(...(await walk(full)));
        else names.push(entry.name);
      }
      return names;
    };
    const names = await walk(created.path);
    assert.deepEqual(names.filter((name) => name.includes('.tmp-')), []);
    assert.ok(names.includes('design.json'));
  });
});

describe('take-over without clobbering (§6.3 P1–P5)', () => {
  const anchor = commentFixture('c_x').anchor;
  const exists = async (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

  /** A folder the agent started with its HTML; the watcher's reconcile seeded a provisional state. */
  const provisionalPage = async (env: StoreEnv, slug: string): Promise<void> => {
    await env.tmp.write(`${slug}/index.html`, '<h1>Early</h1>');
    await env.store.reconcile(slug);
    assert.equal((await readJson(env.tmp.at(`${slug}/.chamber/state.json`))).provisional, true);
  };

  test('P3 — a comment on a provisional design stays in state.json; adoption carries it into design.json', async (t) => {
    const env = await makeEnv(t);
    await provisionalPage(env, 'early');
    const comment = await env.store.addComment('early', { screen: null, viewport: 'laptop', anchor, body: 'Bigger headline' });
    const state = await readJson(env.tmp.at('early/.chamber/state.json'));
    assert.equal(state.provisional, true, 'a comment does not end the provisional phase');
    assert.deepEqual((state.comments as Comment[]).map((entry) => entry.id), [comment.id]);
    assert.equal(await exists(env.tmp.at('early/design.json')), false, 'no design.json is invented for a comment');

    await env.tmp.write('early/design.json', { kind: 'page', title: 'Early', brief: 'The agent brief' });
    await env.store.reconcile('early');
    const design = await readJson(env.tmp.at('early/design.json'));
    assert.equal(design.brief, 'The agent brief');
    assert.deepEqual((design.comments as Comment[]).map((entry) => entry.id), [comment.id]);
    assert.equal(Object.hasOwn(await readJson(env.tmp.at('early/.chamber/state.json')), 'provisional'), false);
  });

  test('P2 — a comment id both files hold keeps state\'s copy; the agent file\'s other comments are added', async (t) => {
    const env = await makeEnv(t);
    await env.tmp.writeDesign('clash', {
      'index.html': '<h1>Clash</h1>',
      '.chamber/state.json': { ...seededState({ kind: 'page', entry: 'index.html', comments: [commentFixture('c_shared1', 'Mine')] }), provisional: true },
      'design.json': { kind: 'page', title: 'Clash', comments: [commentFixture('c_shared1', 'Agent copy'), commentFixture('c_agent01', 'From the agent')] },
    });
    await env.store.reconcile('clash');
    for (const file of ['clash/design.json', 'clash/.chamber/state.json']) {
      const comments = (await readJson(env.tmp.at(file))).comments as Comment[];
      assert.deepEqual(comments.map((entry) => [entry.id, entry.body]), [['c_shared1', 'Mine'], ['c_agent01', 'From the agent']], file);
    }
  });

  test('P4 — renaming a provisional design writes the minimal design.json and clears the flag', async (t) => {
    const env = await makeEnv(t);
    await provisionalPage(env, 'early');
    const patched = await env.store.patch('early', { title: 'Named by me' });
    assert.equal(patched.design.title, 'Named by me');
    const design = await readJson(env.tmp.at('early/design.json'));
    assert.equal(design.title, 'Named by me');
    assert.equal(design.kind, 'page');
    assert.equal(Object.hasOwn(design, 'provisional'), false);
    assert.equal(Object.hasOwn(await readJson(env.tmp.at('early/.chamber/state.json')), 'provisional'), false);
    // From now on state wins as for any design: a later agent brief is re-merged to state's.
    await env.tmp.write('early/design.json', { ...design, brief: 'Too late' });
    await env.store.reconcile('early');
    assert.equal((await readJson(env.tmp.at('early/design.json'))).brief, '');
  });

  test('P5 — a pending page nobody commented on becomes a canvas when the agent says so', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'page', title: 'Switch me' });
    const designFile = path.join(created.path, 'design.json');
    await writeFile(designFile, JSON.stringify({ ...(await readJson(designFile)), kind: 'canvas' }, null, 2), 'utf8');
    await env.store.reconcile(created.slug);
    const state = await readJson(path.join(created.path, '.chamber', 'state.json'));
    assert.equal(state.kind, 'canvas');
    assert.equal(state.entry, null);
    const design = await readJson(designFile);
    assert.equal(design.kind, 'canvas');
    assert.equal(Object.hasOwn(design, 'entry'), false, 'a canvas has no entry');
    assert.equal((await env.store.get(created.slug)).design.kind, 'canvas');
  });

  test('P5 — with a comment the page stays a page and design.json is re-merged', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'page', title: 'Commented' });
    await env.store.addComment(created.slug, { screen: null, viewport: 'laptop', anchor, body: 'Keep this a page' });
    const designFile = path.join(created.path, 'design.json');
    await writeFile(designFile, JSON.stringify({ ...(await readJson(designFile)), kind: 'canvas' }, null, 2), 'utf8');
    await env.store.reconcile(created.slug);
    assert.equal((await readJson(path.join(created.path, '.chamber', 'state.json'))).kind, 'page');
    assert.equal((await readJson(designFile)).kind, 'page');
  });

  test('P5 — once index.html is written the page stays a page', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'page', title: 'Written', html: '<h1>Done</h1>' });
    const designFile = path.join(created.path, 'design.json');
    await writeFile(designFile, JSON.stringify({ ...(await readJson(designFile)), kind: 'canvas' }, null, 2), 'utf8');
    await env.store.reconcile(created.slug);
    assert.equal((await readJson(path.join(created.path, '.chamber', 'state.json'))).kind, 'page');
    assert.equal((await readJson(designFile)).kind, 'page');
  });

  test('§6.3 unchanged — a final design whose agent rewrites the brief is re-merged to state', async (t) => {
    const env = await makeEnv(t);
    const created = await env.store.create({ kind: 'canvas', title: 'Final', brief: 'The user brief' });
    const designFile = path.join(created.path, 'design.json');
    await writeFile(designFile, JSON.stringify({ ...(await readJson(designFile)), brief: 'The agent rewrote it' }, null, 2), 'utf8');
    await env.store.reconcile(created.slug);
    assert.equal((await readJson(designFile)).brief, 'The user brief');
    assert.equal((await readJson(path.join(created.path, '.chamber', 'state.json'))).brief, 'The user brief');
  });

  test('Windows lock — adoption lands although the first state.json rename is refused (a reader had it open)', async (t) => {
    // The Q1 CI failure on windows-latest: the reconcile the design.json event starts renames
    // state.json while something else is reading it (the panel's list refresh, the test's poll,
    // an antivirus scan). One refused rename used to fail the whole reconcile, and nothing ran
    // it again: the event was spent, so the design stayed provisional for good.
    const env = await makeEnv(t);
    await provisionalPage(env, 'locked');
    await env.tmp.write('locked/design.json', { kind: 'canvas', title: 'Locked', brief: 'The agent brief' });
    const stateFile = env.tmp.at('locked/.chamber/state.json');
    refuseRenames(t, (destination, attempt) => destination === stateFile && attempt === 1);
    await env.store.reconcile('locked');
    const state = await readJson(stateFile);
    assert.equal(Object.hasOwn(state, 'provisional'), false, 'adopted, not left provisional');
    assert.equal(state.kind, 'canvas');
    assert.equal(state.brief, 'The agent brief');
    assert.equal((await readJson(env.tmp.at('locked/design.json'))).brief, 'The agent brief');
  });

  test('design.json first (the guide\'s order) — a page whose index.html is not written yet stays a page', async (t) => {
    const env = await makeEnv(t);
    await env.tmp.write('ordered/design.json', { kind: 'page', title: 'Ordered', brief: 'Written first' });
    await env.store.reconcile('ordered');
    const state = await readJson(env.tmp.at('ordered/.chamber/state.json'));
    assert.equal(state.kind, 'page');
    assert.equal(Object.hasOwn(state, 'provisional'), false, 'a parsed design.json gives a final state');
    const design = await readJson(env.tmp.at('ordered/design.json'));
    assert.equal(design.kind, 'page');
    assert.equal(design.brief, 'Written first');
  });

  test('no write loop — two reconciles in a row write neither file, provisional or adopted', async (t) => {
    const env = await makeEnv(t);
    await provisionalPage(env, 'quiet');
    const stateFile = env.tmp.at('quiet/.chamber/state.json');
    const designFile = env.tmp.at('quiet/design.json');
    const mtimeOf = async (file: string): Promise<number | null> => stat(file).then((info) => info.mtimeMs, () => null);

    const assertQuiet = async (): Promise<void> => {
      await env.store.reconcile('quiet'); // settle anything the last write calls for
      const before = [await mtimeOf(stateFile), await mtimeOf(designFile)];
      await new Promise((resolve) => setTimeout(resolve, 30));
      await env.store.reconcile('quiet');
      await env.store.reconcile('quiet');
      assert.deepEqual([await mtimeOf(stateFile), await mtimeOf(designFile)], before);
    };
    await assertQuiet(); // provisional, no design.json
    await env.tmp.write('quiet/design.json', { kind: 'page', title: 'Quiet', brief: 'Adopted' });
    await assertQuiet(); // adopted
  });
});
