// System history (documentation/specs/phase-2-5-technical.md §5.2, AD-3; docs/SPEC.md §6.4): the
// design versions machinery over `_systems/<id>/` through the `VersionTarget` seam. Snapshot,
// compare and restore; restore never touches `.chamber/` and settles the revision afterwards;
// caps and pruning with GC; the Phase 2.5 reasons; index safety (reads never write, a damaged
// index recovers, a newer build's index is left alone, a `.versions` link is refused); auto
// snapshots from `system` events only; the routes behind the bearer token and the id gate.

import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { RestoreVersionResponse, VersionDiffResponse, VersionListResponse } from '../../../src/shared/api.ts';
import { SNAPSHOT_FILES_MAX, VERSIONS_KEEP } from '../../../src/shared/limits.ts';
import type { SystemTokenRules } from '../../../src/shared/system-json.ts';
import type { VersionReason } from '../../../src/shared/types.ts';
import { ApiError, createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemVersionsRoutes } from '../../../src/service/routes/system-versions.ts';
import { createSystemStore, ensureSystemStore, type SystemStore } from '../../../src/service/systems/store.ts';
import { ensureSystemVersions, systemVersionTarget } from '../../../src/service/systems/versions.ts';
import { createVersionsService, type VersionsService } from '../../../src/service/versions.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { pageDesign } from '../render/harness.ts';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** T3's token rules are not built yet (the default throws): light = top-level :root, every value valid (as store.test.ts). */
const RULES: SystemTokenRules = {
  isLight: (ctx) => ctx.kind === 'root',
  isDark: (ctx) => ctx.kind === 'other' && ctx.label === '@media (prefers-color-scheme: dark)',
  classify: (_name, value) => (value.startsWith('#') ? 'colours' : 'spacing'),
  validate: () => ({ ok: true, formula: false }),
};

type Rig = { tmp: TmpRoot; ctx: FakeContext; systems: SystemStore; versions: VersionsService };

const setup = async (t: TestContext, options: { quietMs?: number } = {}): Promise<Rig> => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const systems = createSystemStore({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, selfWrites: ctx.selfWrites, quietMs: 600_000, indexRefreshMs: 5, rules: RULES });
  t.after(() => systems.dispose());
  const versions = createVersionsService({ target: systemVersionTarget(systems, ctx.hub), hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: options.quietMs ?? 600_000 });
  return { tmp, ctx, systems, versions };
};

/** A made system (seed files, state.json at revision 1) with a tokens.css and a note. */
const makeAcme = async (rig: Rig): Promise<string> => {
  const { id } = await rig.systems.create({ name: 'Acme' });
  await rig.tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --brand: #123456;\n}\n');
  await rig.tmp.write(`_systems/${id}/OVERVIEW.md`, 'Calm and plain.\n');
  return id;
};

const rejectsWith = async (promise: Promise<unknown>, code: string, message?: string | RegExp): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, String(error));
    assert.equal(error.code, code);
    if (typeof message === 'string') assert.equal(error.message, message);
    else if (message instanceof RegExp) assert.match(error.message, message);
    return true;
  });
};

/** Link a system to a chat the way the session-links path will: in its state.json (PATCH sessionId is a later task's). */
const linkChat = async (rig: Rig, id: string, sessionId: string): Promise<void> => {
  const file = `_systems/${id}/.chamber/state.json`;
  const state = JSON.parse(await rig.tmp.read(file)) as Record<string, unknown>;
  await rig.tmp.write(file, `${JSON.stringify({ ...state, sessionId }, null, 2)}\n`);
};

const revisionOf = async (rig: Rig, id: string): Promise<number> => (JSON.parse(await rig.tmp.read(`_systems/${id}/.chamber/state.json`)) as { revision: { n: number } }).revision.n;

const listing = async (dir: string): Promise<string[]> => (await readdir(dir).catch(() => [])).sort();

describe('system snapshots', () => {
  test('a snapshot stores the content set, never .chamber or .versions, and emits a system versions event', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    const before = rig.ctx.events.length;
    const created = await rig.versions.create(id, 'manual');
    assert.ok(created);
    assert.equal(created.id, 'v1');
    const index = JSON.parse(await rig.tmp.read(`_systems/${id}/.versions/index.json`)) as { versions: { files: Record<string, string> }[] };
    const tracked = Object.keys(index.versions[0]?.files ?? {}).sort();
    assert.deepEqual(tracked, ['OVERVIEW.md', 'system.json', 'tokens.css']);
    const events = rig.ctx.events.slice(before);
    assert.ok(events.some((event) => event.kind === 'system' && event.system === id && event.systemChange === 'versions' && event.slug === null), JSON.stringify(events));
    // Never a design event: the design list and every design listener stay quiet.
    assert.equal(events.filter((event) => event.kind === 'versions').length, 0);
    // Same tree again: deduped by tree hash.
    assert.equal(await rig.versions.create(id, 'manual'), null);
  });

  test('every Phase 2.5 reason is recorded as given, and the linked chat comes from state.json', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    await linkChat(rig, id, 'ses_acme');
    const reasons: VersionReason[] = ['resync', 'system-change', 'system-update', 'repo-read', 'auto', 'user-edit', 'turn'];
    for (const [n, reason] of reasons.entries()) {
      await rig.tmp.write(`_systems/${id}/OVERVIEW.md`, `Revision ${n}\n`);
      const entry = await rig.versions.snapshot(id, reason);
      assert.ok(entry, reason);
      assert.equal(entry.reason, reason);
      assert.equal(entry.sessionId, 'ses_acme', reason);
    }
    const { versions } = await rig.versions.list(id);
    assert.deepEqual(versions.map((summary) => summary.reason).reverse(), reasons);
  });

  test('a turn snapshots the systems linked to that chat only', async (t) => {
    const rig = await setup(t);
    const acme = await makeAcme(rig);
    const { id: other } = await rig.systems.create({ name: 'Other' });
    await linkChat(rig, acme, 'ses_turn');
    const created = await rig.versions.turn('ses_turn');
    assert.deepEqual(created.map((item) => item.slug), [acme]);
    assert.equal((await rig.versions.list(other)).versions.length, 0);
  });

  test('a design id or a traversal never reaches a system path', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('shop', pageDesign({ 'index.html': '<p>shop</p>' }));
    await rejectsWith(rig.versions.create('shop', 'manual'), 'not-found');
    for (const hostile of ['../shop', '..', 'Acme', '_systems', 'a/b']) await rejectsWith(rig.versions.list(hostile), 'bad-slug');
    assert.deepEqual(await listing(rig.tmp.at('shop/.versions')), []);
  });
});

describe('system compare and restore', () => {
  test('diff names added, removed and modified files against current and between versions', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    const v1 = await rig.versions.create(id, 'manual');
    assert.ok(v1);
    await rig.tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --brand: #654321;\n}\n');
    await rig.tmp.write(`_systems/${id}/notes/voice.md`, 'Short sentences.\n');
    await rm(rig.tmp.at(`_systems/${id}/OVERVIEW.md`));
    assert.deepEqual((await rig.versions.diff(id, v1.id, 'current')).files, [
      { path: 'OVERVIEW.md', change: 'removed' },
      { path: 'notes/voice.md', change: 'added' },
      { path: 'tokens.css', change: 'modified' },
    ]);
    const v2 = await rig.versions.create(id, 'manual');
    assert.ok(v2);
    assert.equal((await rig.versions.diff(id, v1.id, v2.id)).files.length, 3);
    await rejectsWith(rig.versions.diff(id, 'v99', 'current'), 'not-found');
    await rejectsWith(rig.versions.diff(id, 'nope', 'current'), 'bad-request');
  });

  test('restore writes the version back, keeps .chamber untouched, records restore-point and restored, then settles the revision', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    const v1 = await rig.versions.create(id, 'manual');
    assert.ok(v1);

    await rig.tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --brand: #ff0000;\n}\n');
    await rig.tmp.write(`_systems/${id}/notes/extra.md`, 'Added later.\n');
    // The revision follows the edited content (the agent's change settled), so the restore moves it.
    await rig.systems.settleRevision(id);
    const revisionBefore = (await revisionOf(rig, id));
    await rig.tmp.write(`_systems/${id}/.chamber/edits.json`, '{"version":1,"undo":[]}\n');
    const stateBytes = await rig.tmp.read(`_systems/${id}/.chamber/state.json`);
    const editsBytes = await rig.tmp.read(`_systems/${id}/.chamber/edits.json`);

    const before = rig.ctx.events.length;
    const result = await rig.versions.restore(id, v1.id);
    assert.ok(result.restorePoint);
    assert.equal(result.restorePoint.reason, 'restore-point');
    assert.equal(result.before.id, result.restorePoint.id);
    // The restored tree equals v1's, so it is deduped onto v1 itself.
    assert.equal(result.restored.treeHash, v1.treeHash);

    assert.equal(await rig.tmp.read(`_systems/${id}/tokens.css`), ':root {\n  --brand: #123456;\n}\n');
    assert.equal(await rig.tmp.read(`_systems/${id}/notes/extra.md`).catch(() => null), null);
    // .chamber is never touched by the restore itself: edits.json is byte-identical; state.json only by the revision bump below.
    assert.equal(await rig.tmp.read(`_systems/${id}/.chamber/edits.json`), editsBytes);
    assert.equal((await revisionOf(rig, id)), revisionBefore + 1, 'the restore lands as a new revision');
    const withoutRevision = (text: string): Record<string, unknown> => {
      const { revision: _revision, updated: _updated, ...rest } = JSON.parse(text) as Record<string, unknown>;
      return rest;
    };
    assert.deepEqual(withoutRevision(await rig.tmp.read(`_systems/${id}/.chamber/state.json`)), withoutRevision(stateBytes));

    const events = rig.ctx.events.slice(before);
    assert.ok(events.some((event) => event.kind === 'system' && event.systemChange === 'files' && event.system === id));
    assert.ok(events.some((event) => event.kind === 'system' && event.systemChange === 'state' && event.system === id));
    assert.equal(events.filter((event) => event.slug !== null).length, 0, 'no design event');
    assert.equal((await rig.versions.list(id)).dirty, false);
  });

  test('restore waits for the system lock, so it never interleaves with a revision bump', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    const v1 = await rig.versions.create(id, 'manual');
    assert.ok(v1);
    await rig.tmp.write(`_systems/${id}/tokens.css`, ':root {}\n');
    let release!: () => void; // Assigned synchronously by the Promise constructor.
    const held = rig.systems.withLock(id, () => new Promise<void>((resolve) => (release = resolve)));
    const restoring = rig.versions.restore(id, v1.id);
    await sleep(50);
    assert.equal(await rig.tmp.read(`_systems/${id}/tokens.css`), ':root {}\n', 'nothing written while the lock is held');
    release();
    await held;
    await restoring;
    assert.equal(await rig.tmp.read(`_systems/${id}/tokens.css`), ':root {\n  --brand: #123456;\n}\n');
  });

  test('a version whose stored file is gone is refused before anything is written', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    const v1 = await rig.versions.create(id, 'manual');
    assert.ok(v1);
    const objects = rig.tmp.at(`_systems/${id}/.versions/objects`);
    const bucket = (await listing(objects))[0];
    assert.ok(bucket);
    for (const name of await listing(path.join(objects, bucket))) await rm(path.join(objects, bucket, name));
    await rig.tmp.write(`_systems/${id}/tokens.css`, ':root {}\n');
    await rejectsWith(rig.versions.restore(id, v1.id), 'invalid', /damaged/);
    assert.equal(await rig.tmp.read(`_systems/${id}/tokens.css`), ':root {}\n');
  });
});

describe('system caps, pruning and GC', () => {
  test('a system over the file cap takes no snapshot, and a restore is refused with the system sentence before writing', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    const v1 = await rig.versions.create(id, 'manual');
    assert.ok(v1);
    const many = rig.tmp.at(`_systems/${id}/sources/many`);
    await mkdir(many, { recursive: true });
    for (let i = 0; i <= SNAPSHOT_FILES_MAX; i += 1) await writeFile(path.join(many, `f${i}.txt`), String(i));
    assert.equal(await rig.versions.create(id, 'manual'), null);
    await rejectsWith(rig.versions.restore(id, v1.id), 'invalid', /^This design system is too large to keep a restore point .* copy the design system folder somewhere safe, then try again\.$/);
    assert.equal((await listing(many)).length, SNAPSHOT_FILES_MAX + 1, 'nothing was removed');
  });

  test(`only the newest ${VERSIONS_KEEP} versions are kept and objects nothing names are collected`, async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    for (let i = 0; i < VERSIONS_KEEP + 2; i += 1) {
      await rig.tmp.write(`_systems/${id}/OVERVIEW.md`, `Unique text ${i}\n`);
      assert.ok(await rig.versions.create(id, 'manual'), `version ${i}`);
    }
    const { versions } = await rig.versions.list(id);
    assert.equal(versions.length, VERSIONS_KEEP);
    assert.equal(versions.at(-1)?.id, 'v3');
    const index = JSON.parse(await rig.tmp.read(`_systems/${id}/.versions/index.json`)) as { versions: { files: Record<string, string> }[] };
    const named = new Set(index.versions.flatMap((entry) => Object.values(entry.files)));
    const objects = rig.tmp.at(`_systems/${id}/.versions/objects`);
    const stored: string[] = [];
    for (const bucket of await listing(objects)) stored.push(...(await listing(path.join(objects, bucket))));
    assert.deepEqual(new Set(stored), named, 'every stored object is named, every named object is stored');
  });
});

describe('system index safety (§6.4, reused)', () => {
  test('reads never write; a damaged index recovers from the backup; ids never repeat', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    await rig.versions.create(id, 'manual');
    await rig.tmp.write(`_systems/${id}/OVERVIEW.md`, 'Two\n');
    await rig.versions.create(id, 'manual');
    const vdir = rig.tmp.at(`_systems/${id}/.versions`);
    await writeFile(path.join(vdir, 'index.json'), '{"version":1,"next":3,"versions":[{"id":"v2"');
    const filesBefore = await listing(vdir);
    const listed = await rig.versions.list(id);
    assert.equal(listed.history, 'recovered');
    assert.deepEqual(await listing(vdir), filesBefore, 'a read writes nothing');

    await rig.tmp.write(`_systems/${id}/OVERVIEW.md`, 'Three\n');
    const v3 = await rig.versions.create(id, 'manual');
    assert.equal(v3?.id, 'v3');
    assert.ok((await listing(vdir)).some((name) => /^index\.damaged-.*-recovered\.json$/.test(name)), 'the damaged index was set aside');
  });

  test('an unreadable list is an error with the system sentence, never empty', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    await mkdir(rig.tmp.at(`_systems/${id}/.versions/index.json`), { recursive: true });
    await rejectsWith(rig.versions.list(id), 'internal', "Design Chamber could not read this design system's version history right now. Try again in a moment.");
  });

  test("a newer build's index is left alone: no versions listed, snapshots and restores refused", async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    const newer = '{"version":2,"next":5,"versions":[]}\n';
    await rig.tmp.write(`_systems/${id}/.versions/index.json`, newer);
    const listed = await rig.versions.list(id);
    assert.equal(listed.history, 'unsupported');
    assert.equal(listed.versions.length, 0);
    await rejectsWith(rig.versions.create(id, 'manual'), 'invalid', "This design system's version history was saved by a newer version of Design Chamber. Update the extension to save or restore versions here.");
    assert.equal(await rig.tmp.read(`_systems/${id}/.versions/index.json`), newer);
  });

  test('a .versions link out of the system is refused and nothing is written outside', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    const outside = path.join(os.tmpdir(), `dc-outside-${process.pid}-${Date.now()}`);
    await mkdir(outside, { recursive: true });
    t.after(() => rm(outside, { recursive: true, force: true }));
    await symlink(outside, rig.tmp.at(`_systems/${id}/.versions`), 'dir');
    await assert.rejects(rig.versions.create(id, 'manual'));
    assert.deepEqual(await listing(outside), []);
  });

  test('a version-first hand edit is refused with the system wording', async (t) => {
    const rig = await setup(t);
    const id = await makeAcme(rig);
    await rig.tmp.write(`_systems/${id}/.versions/index.json`, '{"version":2,"next":1,"versions":[]}\n');
    let applied = false;
    await rejectsWith(
      rig.versions.userEdit(id, 'user-edit', {
        staleMessage: 'stale',
        precheck: async () => null,
        apply: async () => {
          applied = true;
          return { response: null, written: [] };
        },
      }),
      'invalid',
      "Couldn't save a version first, so nothing was changed. This design system's versions were saved by a newer Design Chamber.",
    );
    assert.equal(applied, false);
  });
});

describe('system auto snapshots', () => {
  test('a system files event snapshots after the quiet period; design events and removed systems do not', async (t) => {
    const rig = await setup(t, { quietMs: 40 });
    const id = await makeAcme(rig);
    // The create emitted `system added`: wait for that auto snapshot to land first.
    await sleep(150);
    const first = (await rig.versions.list(id)).versions.length;
    assert.equal(first, 1, 'the added event took an auto snapshot');

    await rig.tmp.write(`_systems/${id}/OVERVIEW.md`, 'Agent wrote this.\n');
    rig.ctx.hub.emit({ slug: id, kind: 'files' }); // a design event with the same name: ignored
    await sleep(120);
    assert.equal((await rig.versions.list(id)).versions.length, 1);

    rig.ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'files' });
    assert.equal(rig.versions.autoPending(id), true);
    await sleep(150);
    const { versions } = await rig.versions.list(id);
    assert.equal(versions.length, 2);
    assert.equal(versions[0]?.reason, 'auto');

    rig.ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'files' });
    rig.ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'removed' });
    assert.equal(rig.versions.autoPending(id), false);
    rig.ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'files' });
    rig.ctx.hub.emit({ slug: null, kind: 'root' });
    assert.equal(rig.versions.autoPending(id), false);
  });

  test('the design versions service ignores system events', async (t) => {
    const rig = await setup(t);
    const design = createVersionsService({ store: rig.ctx.store, hub: rig.ctx.hub, log: rig.ctx.log, onDispose: rig.ctx.onDispose, quietMs: 600_000 });
    rig.ctx.hub.emit({ slug: null, kind: 'system', system: 'acme', systemChange: 'files' });
    assert.equal(design.autoPending('acme'), false);
  });
});

// ---- routes ----

const TOKEN = 'system-versions-token-0123456789';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemVersionsRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, token: string | null = TOKEN) => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    return { status: answer.status, json: (await answer.json()) as unknown };
  };
  return { tmp, ctx, call };
};

describe('system versions routes', () => {
  test('a missing or wrong token is refused with 401 and nothing is read or written', async (t) => {
    const { tmp, call } = await serve(t);
    await tmp.write('_systems/acme/tokens.css', ':root {}\n');
    for (const [method, url] of [
      ['GET', '/systems/acme/versions'],
      ['GET', '/systems/acme/versions/v1/diff'],
      ['POST', '/systems/acme/versions/v1/restore'],
    ] as const) {
      for (const token of [null, 'wrong-token']) assert.equal((await call(method, url, token)).status, 401, `${method} ${url} ${String(token)}`);
    }
    assert.deepEqual(await listing(tmp.at('_systems/acme/.versions')), []);
  });

  test('a traversal, a bad id or a bad version id is refused before any path is built', async (t) => {
    const { tmp, call } = await serve(t);
    for (const hostile of ['..%2F..%2Fetc', '..%5Cwindows', 'a%00b']) {
      assert.equal((await call('GET', `/systems/${hostile}/versions`)).status, 400, hostile);
      assert.equal((await call('POST', `/systems/${hostile}/versions/v1/restore`)).status, 400, hostile);
    }
    // A literal `..` segment never arrives: the client normalises it away (the encoded forms are above).
    for (const bad of ['Acme', '_systems', '.chamber', '...']) {
      const answer = await call('GET', `/systems/${bad}/versions`);
      assert.equal(answer.status, 400, bad);
    }
    for (const vid of ['1', 'v1x', 'v-1', 'V1']) {
      assert.equal((await call('POST', `/systems/acme/versions/${encodeURIComponent(vid)}/restore`)).status, 400, vid);
      assert.equal((await call('GET', `/systems/acme/versions/v1/diff?against=${encodeURIComponent(vid)}`)).status, 400, vid);
    }
    assert.equal((await call('GET', '/systems/ghost/versions')).status, 404);
    assert.deepEqual(await listing(tmp.root), []);
  });

  test('list, diff and restore over HTTP', async (t) => {
    const { tmp, ctx, call } = await serve(t);
    const { id } = await ensureSystemStore(ctx).create({ name: 'Acme' });
    await tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --a: 1px;\n}\n');
    const v1 = await ensureSystemVersions(ctx).create(id, 'manual');
    assert.ok(v1);
    await tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --a: 2px;\n}\n');

    const listed = await call('GET', `/systems/${id}/versions`);
    assert.equal(listed.status, 200);
    const list = listed.json as VersionListResponse;
    assert.equal(list.versions.length, 1);
    assert.equal(list.dirty, true);

    const diff = await call('GET', `/systems/${id}/versions/${v1.id}/diff?against=current`);
    assert.deepEqual((diff.json as VersionDiffResponse).files, [{ path: 'tokens.css', change: 'modified' }]);

    const restored = await call('POST', `/systems/${id}/versions/${v1.id}/restore`);
    assert.equal(restored.status, 200, JSON.stringify(restored.json));
    assert.equal((restored.json as RestoreVersionResponse).restorePoint?.reason, 'restore-point');
    assert.equal(await readFile(tmp.at(`_systems/${id}/tokens.css`), 'utf8'), ':root {\n  --a: 1px;\n}\n');
    assert.equal((await call('POST', `/systems/${id}/versions/v99/restore`)).status, 404);
  });
});
